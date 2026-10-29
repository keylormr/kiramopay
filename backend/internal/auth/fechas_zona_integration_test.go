package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/testutil"
)

// InsertRefreshToken guardaba issued_at y expires_at con $6::timestamp y
// $7::timestamp: el cast descarta la zona del time.Time y deja la hora de pared,
// y al entrar a la columna TIMESTAMPTZ Postgres la toma como hora de la zona de
// la SESION. Produccion esta en GMT y no se notaba; en cualquier otra zona el
// vencimiento se corria tantas horas como el desfase: un refresh de siete dias
// vivia seis horas de mas en America/Costa_Rica, y en Asia/Tokyo nacia vencido
// nueve horas antes de emitirse y la renovacion lo rechazaba.
//
// La prueba corre el INSERT en una sesion que no es UTC y lee el instante
// guardado desde otra: tiene que ser el que mando la aplicacion.
func TestInsertRefreshToken_NoDependeDeLaZonaDeLaSesion(t *testing.T) {
	for _, zona := range []string{"America/Costa_Rica", "Asia/Tokyo"} {
		t.Run(zona, func(t *testing.T) {
			pool := testutil.TestDB(t)
			userID := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
			repo := auth.NewRepository(testutil.PoolConZona(t, zona), nil)
			ctx := context.Background()

			emitido := time.Now().UTC().Truncate(time.Microsecond)
			vence := emitido.Add(15 * time.Minute)
			rec := &auth.RefreshTokenRecord{
				JTI:       uuid.NewString(),
				UserID:    userID,
				FamilyID:  uuid.NewString(),
				TokenHash: "hash-del-token",
				IssuedAt:  emitido,
				ExpiresAt: vence,
			}
			if err := repo.InsertRefreshToken(ctx, rec); err != nil {
				t.Fatalf("InsertRefreshToken: %v", err)
			}

			var guardadoEmitido, guardadoVence time.Time
			if err := pool.QueryRow(ctx,
				`SELECT issued_at, expires_at FROM refresh_tokens WHERE jti = $1::uuid`,
				rec.JTI).Scan(&guardadoEmitido, &guardadoVence); err != nil {
				t.Fatalf("leer el refresh guardado: %v", err)
			}
			if !guardadoEmitido.Equal(emitido) {
				t.Errorf("issued_at guardado = %s, se mando %s (desfase %s)",
					guardadoEmitido.UTC(), emitido, guardadoEmitido.Sub(emitido))
			}
			if !guardadoVence.Equal(vence) {
				t.Errorf("expires_at guardado = %s, se mando %s (desfase %s)",
					guardadoVence.UTC(), vence, guardadoVence.Sub(vence))
			}

			// Lo que se nota en la practica: un refresh recien emitido, de vida
			// corta, tiene que poder renovarse.
			if _, _, err := repo.ConsumeRefreshToken(ctx, rec.JTI, rec.TokenHash); err != nil {
				t.Errorf("ConsumeRefreshToken rechazo un refresh vigente: %v", err)
			}
		})
	}
}

// Lo mismo para la sesion: CreateSession y MoverSesionAlRotar guardan
// expires_at, y ahora lo declaran ::timestamptz en vez de dejar que Postgres lo
// infiera. Esta prueba fija que el instante guardado no cambie con la zona de
// la sesion.
func TestSesion_ElVencimientoNoDependeDeLaZonaDeLaSesion(t *testing.T) {
	for _, zona := range []string{"America/Costa_Rica", "Asia/Tokyo"} {
		t.Run(zona, func(t *testing.T) {
			pool := testutil.TestDB(t)
			userID := testutil.SeedTestUser(t, pool, "702650930", "hash-de-prueba")
			repo := auth.NewRepository(testutil.PoolConZona(t, zona), nil)
			ctx := context.Background()

			venceAlCrear := time.Now().UTC().Add(7 * 24 * time.Hour).Truncate(time.Microsecond)
			s := &auth.SessionRecord{
				ID:         uuid.NewString(),
				UserID:     userID,
				AccessJTI:  uuid.NewString(),
				RefreshJTI: uuid.NewString(),
				ExpiresAt:  venceAlCrear,
			}
			if err := repo.CreateSession(ctx, s); err != nil {
				t.Fatalf("CreateSession: %v", err)
			}
			if got := vencimientoDeLaSesion(t, pool, s.ID); !got.Equal(venceAlCrear) {
				t.Errorf("CreateSession: expires_at = %s, se mando %s (desfase %s)",
					got.UTC(), venceAlCrear, got.Sub(venceAlCrear))
			}

			venceAlRotar := venceAlCrear.Add(time.Hour)
			rotada := &auth.SessionRecord{
				AccessJTI:  uuid.NewString(),
				RefreshJTI: uuid.NewString(),
				ExpiresAt:  venceAlRotar,
			}
			movida, err := repo.MoverSesionAlRotar(ctx, userID, s.RefreshJTI, rotada)
			if err != nil || !movida {
				t.Fatalf("MoverSesionAlRotar: movida=%v err=%v", movida, err)
			}
			if got := vencimientoDeLaSesion(t, pool, s.ID); !got.Equal(venceAlRotar) {
				t.Errorf("MoverSesionAlRotar: expires_at = %s, se mando %s (desfase %s)",
					got.UTC(), venceAlRotar, got.Sub(venceAlRotar))
			}
		})
	}
}

func vencimientoDeLaSesion(t *testing.T, pool *pgxpool.Pool, id string) time.Time {
	t.Helper()
	var vence time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT expires_at FROM user_sessions WHERE id = $1::uuid`, id).Scan(&vence); err != nil {
		t.Fatalf("leer el vencimiento de la sesion: %v", err)
	}
	return vence
}
