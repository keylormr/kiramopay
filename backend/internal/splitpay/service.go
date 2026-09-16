package splitpay

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/identifier"
)

// BuscadorDeCuentas resuelve el telefono de un participante a una cuenta real.
//
// Existe porque una division de cuenta cuyos participantes no son cuentas de
// KiramoPay no se puede cobrar: la cuota se guarda con user_id nulo, el pago
// busca la cuota por el id de quien paga y no la encuentra nunca, y el grupo se
// queda "activo" para siempre. Antes de esto la pantalla solo pedia nombre y
// telefono, asi que NINGUNA division creada desde la app era pagable.
type BuscadorDeCuentas interface {
	FindByPhone(ctx context.Context, telefono string) (*user.UserRecord, error)
}

type Service struct {
	repo    *Repository
	tx      *transaction.Service
	cuentas BuscadorDeCuentas
}

func NewService(repo *Repository, tx *transaction.Service, cuentas BuscadorDeCuentas) *Service {
	return &Service{repo: repo, tx: tx, cuentas: cuentas}
}

func (s *Service) CreateSplit(ctx context.Context, creatorID string, req *CreateSplitRequest) (*SplitGroup, []SplitShare, error) {
	if req.Title == "" {
		return nil, nil, ErrTitleRequired
	}
	if req.TotalAmount <= 0 {
		return nil, nil, ErrInvalidAmount
	}
	if len(req.Participants) < 1 {
		return nil, nil, ErrParticipantRequired
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	// Resolver ANTES de escribir nada: si algun participante no tiene cuenta,
	// la division entera se rechaza y no queda un grupo a medias.
	if err := s.resolverParticipantes(ctx, creatorID, req); err != nil {
		return nil, nil, err
	}

	group := &SplitGroup{
		ID:          uuid.New().String(),
		CreatorID:   creatorID,
		Title:       req.Title,
		Description: req.Description,
		TotalAmount: req.TotalAmount,
		Currency:    req.Currency,
		SplitType:   req.SplitType,
		Status:      "active",
	}

	shares, err := s.calculateShares(group.ID, creatorID, req)
	if err != nil {
		return nil, nil, err
	}

	// El grupo y sus cuotas se escriben juntos: un grupo sin todas sus cuotas
	// no cuadra con su total y nadie podria liquidarlo.
	if err := s.repo.CrearGrupoConCuotas(ctx, group, shares); err != nil {
		return nil, nil, err
	}

	return group, shares, nil
}

// resolverParticipantes exige que cada participante sea una cuenta de
// KiramoPay y completa su id. Rechaza nombrando a quien falta, en vez de
// guardar una cuota que nadie podra pagar nunca.
func (s *Service) resolverParticipantes(ctx context.Context, creatorID string, req *CreateSplitRequest) error {
	if s.cuentas == nil {
		return ErrAccountLookupUnavailable
	}
	vistos := map[string]bool{creatorID: true}
	for i := range req.Participants {
		p := &req.Participants[i]
		// El user_id que venga en la peticion se ignora: es un dato del cliente
		// que nadie verifica, y aceptarlo permitiria colgarle una deuda a una
		// cuenta cualquiera con solo saber su uuid. El telefono, en cambio, se
		// resuelve contra la base.
		p.UserID = ""
		if p.UserPhone == "" {
			return ErrPhoneRequired
		}
		kind, canonico, err := identifier.Classify(p.UserPhone)
		if err != nil || kind != identifier.KindPhone {
			return ErrInvalidPhone
		}
		u, err := s.cuentas.FindByPhone(ctx, canonico)
		if err != nil || u == nil {
			return ErrAccountNotFound
		}
		p.UserID = u.ID
		p.UserPhone = canonico
		if p.UserName == "" {
			p.UserName = strings.TrimSpace(u.FirstName + " " + u.LastName)
		}
		if vistos[p.UserID] {
			if p.UserID == creatorID {
				return ErrSelfIncluded
			}
			return ErrDuplicateParticipant
		}
		vistos[p.UserID] = true
	}
	return nil
}

func (s *Service) GetSplit(ctx context.Context, groupID string) (*SplitGroup, []SplitShare, error) {
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return nil, nil, ErrGroupNotFound
	}

	shares, err := s.repo.GetGroupShares(ctx, groupID)
	if err != nil {
		return nil, nil, err
	}

	return group, shares, nil
}

func (s *Service) ListUserSplits(ctx context.Context, userID string) ([]SplitGroup, error) {
	return s.repo.ListUserGroups(ctx, userID)
}

func (s *Service) PayShare(ctx context.Context, userID, groupID string) error {
	if userID == "" {
		return ErrUnauthenticated
	}
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return ErrGroupNotFound
	}
	if group.Status != "active" {
		return ErrNotActive
	}

	// Locate this user's pending share.
	shares, err := s.repo.GetGroupShares(ctx, groupID)
	if err != nil {
		return err
	}
	var share *SplitShare
	for i := range shares {
		if shares[i].UserID == userID {
			share = &shares[i]
			break
		}
	}
	if share == nil {
		return ErrNoShareForUser
	}
	if share.Status == "paid" {
		return nil // idempotent: already settled
	}

	// Settle the money THROUGH THE LEDGER: the participant pays their share to
	// the split creator. The creator's own share moves no money. Only mark the
	// share paid AFTER the transfer succeeds.
	if userID != group.CreatorID && share.Amount > 0 {
		// Counterparty names come from the shares already loaded: the creator's
		// name for the payer's row, the payer's for the creator's row. Optional —
		// missing names degrade to the frontend's generic title.
		creatorName := ""
		for i := range shares {
			if shares[i].UserID == group.CreatorID {
				creatorName = shares[i].UserName
				break
			}
		}
		idem := fmt.Sprintf("split:%s:%s", groupID, userID)
		if _, _, err := s.tx.CreateTransfer(ctx, &transaction.CreateTransferRequest{
			FromUserID:               userID,
			ToUserID:                 group.CreatorID,
			Amount:                   share.Amount,
			Currency:                 group.Currency,
			Fee:                      0,
			Description:              "Split: " + group.Title,
			IdempotencyKey:           idem,
			TxType:                   transaction.TypeP2PSend,
			ReceiveType:              transaction.TypeP2PReceive,
			SenderCounterpartyName:   creatorName,
			ReceiverCounterpartyName: share.UserName,
		}); err != nil {
			return fmt.Errorf("settle split share: %w", err)
		}
	}

	if err := s.repo.PayShare(ctx, groupID, userID); err != nil {
		return err
	}

	s.liquidarSiNoQuedaNadaPendiente(ctx, groupID)
	return nil
}

func (s *Service) DeclineShare(ctx context.Context, userID, groupID string) error {
	if userID == "" {
		return ErrUnauthenticated
	}
	if err := s.repo.DeclineShare(ctx, groupID, userID); err != nil {
		return err
	}
	// Rechazar tambien puede dejar el grupo sin cuotas pendientes. Sin esto, un
	// grupo en el que la ultima persona dice "yo no pago" se queda "activo" para
	// siempre, esperando un pago que ya nadie va a hacer.
	s.liquidarSiNoQuedaNadaPendiente(ctx, groupID)
	return nil
}

// liquidarSiNoQuedaNadaPendiente marca el grupo como liquidado cuando ya no
// queda ninguna cuota por pagar. Es best-effort a proposito: es un resumen del
// estado de las cuotas, no la verdad del dinero, y esa ya quedo en el libro.
func (s *Service) liquidarSiNoQuedaNadaPendiente(ctx context.Context, groupID string) {
	pending, err := s.repo.CountPendingShares(ctx, groupID)
	if err != nil || pending != 0 {
		return
	}
	_ = s.repo.UpdateGroupStatus(ctx, groupID, "settled")
}

func (s *Service) CancelSplit(ctx context.Context, userID, groupID string) error {
	group, err := s.repo.GetGroup(ctx, groupID)
	if err != nil {
		return ErrGroupNotFound
	}
	if group.CreatorID != userID {
		return ErrNotCreator
	}
	return s.repo.UpdateGroupStatus(ctx, groupID, "cancelled")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// calculateShares reparte el total entre el creador y los participantes.
//
// El creador cuenta como uno mas y su cuota nace "paid": es quien puso el
// dinero, lo que le deben son las demas. Antes no tenia cuota, asi que la
// division de "partes iguales" repartia el total SOLO entre los invitados
// —cada uno pagaba de mas— y la pantalla mostraba una cifra distinta a la que
// guardaba el servidor, porque ella si dividia entre uno mas.
//
// En los tres modos la suma de las cuotas es exactamente el total: el sobrante
// de la division entera y el que dejan los porcentajes al truncarse van a la
// primera cuota. Sin eso, el creador se comia la diferencia sin saberlo.
func (s *Service) calculateShares(groupID, creatorID string, req *CreateSplitRequest) ([]SplitShare, error) {
	nuevaCuota := func(userID, telefono, nombre string, monto int64) SplitShare {
		estado := "pending"
		if userID == creatorID {
			estado = "paid"
		}
		return SplitShare{
			ID:        uuid.New().String(),
			GroupID:   groupID,
			UserID:    userID,
			UserPhone: telefono,
			UserName:  nombre,
			Amount:    monto,
			Status:    estado,
		}
	}

	var shares []SplitShare

	switch req.SplitType {
	case "", "equal":
		personas := int64(len(req.Participants) + 1) // +1: el creador
		porPersona := req.TotalAmount / personas
		sobrante := req.TotalAmount - porPersona*personas
		if porPersona <= 0 {
			return nil, ErrTotalTooSmall
		}

		shares = append(shares, nuevaCuota(creatorID, "", "", porPersona+sobrante))
		for _, p := range req.Participants {
			shares = append(shares, nuevaCuota(p.UserID, p.UserPhone, p.UserName, porPersona))
		}

	case "custom":
		var total int64
		for _, p := range req.Participants {
			if p.Amount <= 0 {
				return nil, ErrCustomAmountRequired
			}
			total += p.Amount
		}
		if total > req.TotalAmount {
			return nil, ErrExceedsTotal
		}
		// Lo que no se reparte queda a cargo del creador: es su cuenta.
		shares = append(shares, nuevaCuota(creatorID, "", "", req.TotalAmount-total))
		for _, p := range req.Participants {
			shares = append(shares, nuevaCuota(p.UserID, p.UserPhone, p.UserName, p.Amount))
		}

	case "percentage":
		var totalPct float64
		for _, p := range req.Participants {
			if p.Percentage <= 0 {
				return nil, ErrPercentageRequired
			}
			totalPct += p.Percentage
		}
		if totalPct > 100.0 {
			return nil, ErrPercentageExceedsTotal
		}
		var repartido int64
		invitadas := make([]SplitShare, 0, len(req.Participants))
		for _, p := range req.Participants {
			monto := int64(float64(req.TotalAmount) * p.Percentage / 100)
			if monto <= 0 {
				return nil, ErrPercentageRoundsToZero
			}
			repartido += monto
			invitadas = append(invitadas, nuevaCuota(p.UserID, p.UserPhone, p.UserName, monto))
		}
		// El truncado de cada porcentaje deja centimos sueltos; se los queda el
		// creador junto con el porcentaje que no se asigno.
		shares = append(shares, nuevaCuota(creatorID, "", "", req.TotalAmount-repartido))
		shares = append(shares, invitadas...)

	default:
		return nil, ErrInvalidSplitType
	}

	return shares, nil
}
