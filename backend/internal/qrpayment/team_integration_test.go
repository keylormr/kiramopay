package qrpayment_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// seedEmployee inserts a third user (the shop employee) with a wallet at zero,
// so the tests can assert their PERSONAL money never moves when they collect
// for the shop.
func seedEmployee(t *testing.T, pool *pgxpool.Pool, cedula string) string {
	t.Helper()
	const userID = "00000000-0000-0000-0000-0000000000e1"
	const walletID = "00000000-0000-0000-0000-0000000001e1"
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, first_name, last_name, password_hash, status, kyc_level)
		 VALUES ($1, fn_pii_encrypt($2), fn_pii_hmac($2), fn_pii_encrypt('+50688889999'), fn_pii_hmac('+50688889999'), 'Empleado', 'Prueba', 'dummy_hash', 'active', 1)
		 ON CONFLICT (id) DO NOTHING`, userID, cedula); err != nil {
		t.Fatalf("seed employee: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO wallets (id, user_id, balance_crc, balance_usd) VALUES ($1, $2, 0, 0)
		 ON CONFLICT (user_id) DO NOTHING`, walletID, userID); err != nil {
		t.Fatalf("seed employee wallet: %v", err)
	}
	return userID
}

// The owner builds the team by cedula; the roster and the switcher reflect it,
// and nobody outside the team can read it.
func TestStaff_AddByCedula_RolesAndVisibility(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	employee := seedEmployee(t, pool, "303330333")

	// Unknown cedula and self-add are both rejected.
	if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "999999999", Role: "cashier"}); err == nil {
		t.Fatal("adding an unknown cedula must fail")
	}
	if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "700000000", Role: "cashier"}); err == nil {
		t.Fatal("adding the owner to their own team must fail")
	}
	if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "303330333", Role: "boss"}); err == nil {
		t.Fatal("an unknown role must fail")
	}

	member, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "303330333", Role: "cashier"})
	if err != nil {
		t.Fatalf("add staff: %v", err)
	}
	if member.UserID != employee || member.Role != "cashier" || member.Status != "active" {
		t.Fatalf("unexpected staff row: %+v", member)
	}
	if member.FirstName != "Empleado" {
		t.Fatalf("staff row must carry the user's name, got %q", member.FirstName)
	}

	// The shop shows up in the employee's switcher with their role attached;
	// the owner keeps role owner.
	if ms, err := svc.GetMerchants(ctx, employee); err != nil || len(ms) != 1 || ms[0].Role != "cashier" || ms[0].ID != qr.MerchantID {
		t.Fatalf("employee GetMerchants = %+v (err %v), want the shop with role cashier", ms, err)
	}
	if ms, err := svc.GetMerchants(ctx, owner); err != nil || len(ms) != 1 || ms[0].Role != "owner" {
		t.Fatalf("owner GetMerchants = %+v (err %v), want role owner", ms, err)
	}

	// Roster: owner reads it, nobody else does.
	if roster, err := svc.ListStaff(ctx, qr.MerchantID, owner); err != nil || len(roster) != 1 {
		t.Fatalf("owner roster = %+v (err %v)", roster, err)
	}
	if _, err := svc.ListStaff(ctx, qr.MerchantID, employee); err == nil {
		t.Fatal("a cashier must not read the roster")
	}
	if _, err := svc.ListStaff(ctx, qr.MerchantID, payer); err == nil {
		t.Fatal("an outsider must not read the roster")
	}
}

// A cashier collects FOR THE SHOP: the merchant wallet gets the money, their
// personal wallet does not move, and the sale is attributed to them and to the
// location the QR was created for.
func TestStaff_CashierCollectsForShop_WithAttribution(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	employee := seedEmployee(t, pool, "404440444")

	if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "404440444", Role: "cashier"}); err != nil {
		t.Fatalf("add staff: %v", err)
	}
	loc, err := svc.CreateLocation(ctx, qr.MerchantID, owner, &qrpayment.LocationRequest{Name: "Sucursal Centro", Address: "Frente al parque"})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}

	const amount int64 = 20000 // ₡200.00
	const fee int64 = 100      // 0.50%
	empBefore := walletCRC(t, pool, employee)
	bizBefore, err := svc.MerchantBalance(ctx, qr.MerchantID, owner, "CRC")
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	code, err := svc.CreateQRCode(ctx, employee, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: amount, Currency: "CRC",
		MerchantID: qr.MerchantID, LocationID: loc.ID,
	})
	if err != nil {
		t.Fatalf("cashier CreateQRCode: %v", err)
	}
	pay, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: code.QRData, Currency: "CRC"})
	if err != nil {
		t.Fatalf("ScanAndPay: %v", err)
	}

	if pay.CollectedBy != employee {
		t.Fatalf("payment collected_by = %q, want the cashier %q", pay.CollectedBy, employee)
	}
	if pay.LocationID != loc.ID {
		t.Fatalf("payment location = %q, want %q", pay.LocationID, loc.ID)
	}
	if got := walletCRC(t, pool, employee); got != empBefore {
		t.Fatalf("cashier personal wallet moved: %d -> %d — shop money must not touch it", empBefore, got)
	}
	bizAfter, err := svc.MerchantBalance(ctx, qr.MerchantID, owner, "CRC")
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if bizAfter-bizBefore != amount-fee {
		t.Fatalf("merchant balance delta = %d, want %d", bizAfter-bizBefore, amount-fee)
	}

	// The whole team reads the same sales feed; outsiders read nothing.
	sales, err := svc.MerchantPayments(ctx, qr.MerchantID, employee, 10)
	if err != nil || len(sales) != 1 || sales[0].ID != pay.ID {
		t.Fatalf("cashier sales feed = %+v (err %v)", sales, err)
	}
	if _, err := svc.MerchantPayments(ctx, qr.MerchantID, payer, 10); err == nil {
		t.Fatal("an outsider must not read the sales feed")
	}

	// A cashier collects but has no access to the till or the team.
	if _, err := svc.MerchantBalance(ctx, qr.MerchantID, employee, "CRC"); err == nil {
		t.Fatal("a cashier must not read the business balance")
	}
	if err := svc.WithdrawToOwner(ctx, qr.MerchantID, employee, "CRC", 100, "wd-cashier-try"); err == nil {
		t.Fatal("a cashier must not withdraw the business balance")
	}
	if _, err := svc.AddStaff(ctx, qr.MerchantID, employee, &qrpayment.AddStaffRequest{Cedula: "702650930", Role: "cashier"}); err == nil {
		t.Fatal("a cashier must not manage the team")
	}
}

// Revoking removes every power at once; re-adding as manager grants the
// manager set (balance yes, withdraw still owner-only).
func TestStaff_RevokeAndReactivateAsManager(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	seedEmployee(t, pool, "505550555")

	member, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "505550555", Role: "cashier"})
	if err != nil {
		t.Fatalf("add staff: %v", err)
	}
	if err := svc.RevokeStaff(ctx, qr.MerchantID, owner, member.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	if _, err := svc.CreateQRCode(ctx, member.UserID, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 1000, Currency: "CRC", MerchantID: qr.MerchantID,
	}); err == nil {
		t.Fatal("a revoked cashier must not charge for the shop")
	}
	if _, err := svc.MerchantPayments(ctx, qr.MerchantID, member.UserID, 10); err == nil {
		t.Fatal("a revoked cashier must not read the sales feed")
	}
	if ms, err := svc.GetMerchants(ctx, member.UserID); err != nil || len(ms) != 0 {
		t.Fatalf("a revoked member still sees the shop in their switcher: %+v (err %v)", ms, err)
	}

	// Re-add, now as manager: same row reactivated, not a duplicate.
	again, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "505550555", Role: "manager"})
	if err != nil {
		t.Fatalf("re-add: %v", err)
	}
	if again.ID != member.ID || again.Role != "manager" || again.Status != "active" {
		t.Fatalf("re-add must reactivate the same row as manager, got %+v", again)
	}
	if _, err := svc.MerchantBalance(ctx, qr.MerchantID, again.UserID, "CRC"); err != nil {
		t.Fatalf("a manager must read the business balance: %v", err)
	}
	if err := svc.WithdrawToOwner(ctx, qr.MerchantID, again.UserID, "CRC", 100, "wd-manager-try"); err == nil {
		t.Fatal("withdrawing stays owner-only, even for a manager")
	}
}

// The report is the payoff of the attribution phase 3 records: exact totals,
// a per-location and a per-collector breakdown (with an "unattributed" bucket
// each), and it is readable by owner/manager only.
func TestMerchantReport_AggregationAndPermissions(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	employee := seedEmployee(t, pool, "808880888")

	member, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "808880888", Role: "cashier"})
	if err != nil {
		t.Fatalf("add cashier: %v", err)
	}
	loc, err := svc.CreateLocation(ctx, qr.MerchantID, owner, &qrpayment.LocationRequest{Name: "Sucursal Norte"})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}

	// Sale 1: the cashier charges 20000 at the location (fee 100 @ 0.50%).
	code1, err := svc.CreateQRCode(ctx, employee, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 20000, Currency: "CRC", MerchantID: qr.MerchantID, LocationID: loc.ID,
	})
	if err != nil {
		t.Fatalf("cashier qr: %v", err)
	}
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: code1.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("pay 1: %v", err)
	}
	// Sale 2: the owner charges 10000 with no location (fee 50).
	code2, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 10000, Currency: "CRC", MerchantID: qr.MerchantID,
	})
	if err != nil {
		t.Fatalf("owner qr: %v", err)
	}
	if _, err := svc.ScanAndPay(ctx, payer, &qrpayment.ScanQRPaymentRequest{QRData: code2.QRData, Currency: "CRC"}); err != nil {
		t.Fatalf("pay 2: %v", err)
	}

	rep, err := svc.MerchantReport(ctx, qr.MerchantID, owner, 7, 0)
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	if rep.Totals.Gross != 30000 || rep.Totals.Fee != 150 || rep.Totals.Net != 29850 || rep.Totals.Count != 2 {
		t.Fatalf("totals = %+v, want gross 30000 / fee 150 / net 29850 / count 2", rep.Totals)
	}
	var dGross, dFee int64
	var dCount int
	for _, d := range rep.Daily {
		dGross += d.Gross
		dFee += d.Fee
		dCount += d.Count
	}
	if len(rep.Daily) == 0 || dGross != 30000 || dFee != 150 || dCount != 2 {
		t.Fatalf("daily series does not add up to the totals: %+v", rep.Daily)
	}

	find := func(bs []qrpayment.ReportBucket, key string) *qrpayment.ReportBucket {
		for i := range bs {
			if bs[i].Key == key {
				return &bs[i]
			}
		}
		return nil
	}
	if b := find(rep.ByLocation, loc.ID); b == nil || b.Gross != 20000 || b.Count != 1 || b.Label != "Sucursal Norte" {
		t.Fatalf("location bucket = %+v", b)
	}
	if b := find(rep.ByLocation, ""); b == nil || b.Gross != 10000 || b.Count != 1 {
		t.Fatalf("unattributed location bucket = %+v", b)
	}
	if b := find(rep.ByCollector, employee); b == nil || b.Gross != 20000 || b.Label != "Empleado Prueba" {
		t.Fatalf("cashier bucket = %+v", b)
	}
	if b := find(rep.ByCollector, owner); b == nil || b.Gross != 10000 || b.Label != "Admin User" {
		t.Fatalf("owner bucket = %+v", b)
	}

	// The numbers of the business are not the cashier's, nor an outsider's.
	if _, err := svc.MerchantReport(ctx, qr.MerchantID, employee, 7, 0); err == nil {
		t.Fatal("a cashier must not read the report")
	}
	if _, err := svc.MerchantReport(ctx, qr.MerchantID, payer, 7, 0); err == nil {
		t.Fatal("an outsider must not read the report")
	}
	// A manager can.
	if _, err := svc.UpdateStaff(ctx, qr.MerchantID, owner, member.ID, &qrpayment.UpdateStaffRequest{Role: "manager"}); err != nil {
		t.Fatalf("promote to manager: %v", err)
	}
	if _, err := svc.MerchantReport(ctx, qr.MerchantID, employee, 7, 0); err != nil {
		t.Fatalf("a manager must read the report: %v", err)
	}
}

// Locations and catalog: managers run them, cashiers only read them, and the
// write path validates its inputs.
func TestLocationsAndCatalog_Permissions(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	seedEmployee(t, pool, "606660666")

	manager, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "606660666", Role: "manager"})
	if err != nil {
		t.Fatalf("add manager: %v", err)
	}

	// Catalog CRUD as manager, with price validation.
	if _, err := svc.CreateCatalogItem(ctx, qr.MerchantID, manager.UserID, &qrpayment.CatalogItemRequest{Name: "Cafe", PriceMinor: 0}); err == nil {
		t.Fatal("a zero price must be rejected")
	}
	item, err := svc.CreateCatalogItem(ctx, qr.MerchantID, manager.UserID, &qrpayment.CatalogItemRequest{Name: "Cafe", PriceMinor: 120000})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	if item.Currency != "CRC" {
		t.Fatalf("default currency = %q, want CRC", item.Currency)
	}
	inactive := false
	if _, err := svc.UpdateCatalogItem(ctx, qr.MerchantID, manager.UserID, item.ID, &qrpayment.CatalogItemRequest{Active: &inactive}); err != nil {
		t.Fatalf("update item: %v", err)
	}
	items, err := svc.ListCatalog(ctx, qr.MerchantID, manager.UserID)
	if err != nil || len(items) != 1 || items[0].Active {
		t.Fatalf("catalog after deactivate = %+v (err %v)", items, err)
	}
	if err := svc.DeleteCatalogItem(ctx, qr.MerchantID, manager.UserID, item.ID); err != nil {
		t.Fatalf("delete item: %v", err)
	}

	// Locations: manager writes; deactivated location cannot charge.
	loc, err := svc.CreateLocation(ctx, qr.MerchantID, manager.UserID, &qrpayment.LocationRequest{Name: "Kiosko"})
	if err != nil {
		t.Fatalf("create location: %v", err)
	}
	off := false
	if _, err := svc.UpdateLocation(ctx, qr.MerchantID, manager.UserID, loc.ID, &qrpayment.LocationRequest{Active: &off}); err != nil {
		t.Fatalf("deactivate location: %v", err)
	}
	if _, err := svc.CreateQRCode(ctx, owner, &qrpayment.CreateQRCodeRequest{
		Type: "merchant_fixed", Amount: 1000, Currency: "CRC", MerchantID: qr.MerchantID, LocationID: loc.ID,
	}); err == nil || !strings.Contains(err.Error(), "location") {
		t.Fatalf("charging for a deactivated location must fail, got %v", err)
	}

	// Cashiers read but do not write.
	seedCashier := func() string {
		const cid = "00000000-0000-0000-0000-0000000000e2"
		if _, err := pool.Exec(ctx,
			`INSERT INTO users (id, cedula_enc, cedula_hash, phone_enc, phone_hash, first_name, last_name, password_hash, status, kyc_level)
			 VALUES ($1, fn_pii_encrypt('707770777'), fn_pii_hmac('707770777'), fn_pii_encrypt('+50688887777'), fn_pii_hmac('+50688887777'), 'Caja', 'Dos', 'dummy_hash', 'active', 1)
			 ON CONFLICT (id) DO NOTHING`, cid); err != nil {
			t.Fatalf("seed cashier: %v", err)
		}
		if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{Cedula: "707770777", Role: "cashier"}); err != nil {
			t.Fatalf("add cashier: %v", err)
		}
		return cid
	}
	cashier := seedCashier()
	if _, err := svc.ListCatalog(ctx, qr.MerchantID, cashier); err != nil {
		t.Fatalf("a cashier must read the catalog: %v", err)
	}
	if _, err := svc.ListLocations(ctx, qr.MerchantID, cashier); err != nil {
		t.Fatalf("a cashier must read the locations: %v", err)
	}
	if _, err := svc.CreateCatalogItem(ctx, qr.MerchantID, cashier, &qrpayment.CatalogItemRequest{Name: "Te", PriceMinor: 1000}); err == nil {
		t.Fatal("a cashier must not write the catalog")
	}
	if _, err := svc.CreateLocation(ctx, qr.MerchantID, cashier, &qrpayment.LocationRequest{Name: "Otro"}); err == nil {
		t.Fatal("a cashier must not create locations")
	}
}
