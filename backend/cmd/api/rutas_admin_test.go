package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strconv"
	"strings"
	"testing"
)

// Las pruebas de los handlers montan las rutas a mano, sin los middlewares de
// main.go: si una ruta del panel de eliminaciones se moviera fuera del grupo que
// exige el rol de administrador y la sesion viva, ninguna lo notaria. Esta lee
// main.go y lo exige.
func TestLasRutasDelPanelDeEliminacionesPidenAdministrador(t *testing.T) {
	f, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	montadas := map[string]bool{}
	var pila []ast.Node
	ast.Inspect(f, func(n ast.Node) bool {
		if n == nil {
			pila = pila[:len(pila)-1]
			return true
		}
		pila = append(pila, n)
		ruta, metodo, ok := rutaRegistrada(n)
		if !ok || !strings.HasPrefix(ruta, "/admin/account-deletion-") {
			return true
		}
		montadas[metodo+" "+ruta] = true
		admin, sesion := guardasDelGrupo(pila)
		if !admin || !sesion {
			t.Errorf("%s %s se monta fuera del grupo con RequireAdmin y RequireLiveSession (admin=%v, sesion=%v)", metodo, ruta, admin, sesion)
		}
		return true
	})
	for _, r := range []string{
		"Get /admin/account-deletion-requests",
		"Post /admin/account-deletion-requests/{id}/process",
		"Post /admin/account-deletion-requests/{id}/reject",
		"Get /admin/account-deletion-responses",
		"Post /admin/account-deletion-responses/{id}/delivered",
		"Post /admin/account-deletion-responses/{id}/contact",
	} {
		if !montadas[r] {
			t.Errorf("main.go no monta %s", r)
		}
	}
}

// rutaRegistrada reconoce r.Get("/ruta", h), r.Post(...) y demas.
func rutaRegistrada(n ast.Node) (ruta, metodo string, ok bool) {
	call, ok := n.(*ast.CallExpr)
	if !ok || len(call.Args) != 2 {
		return "", "", false
	}
	sel, ok := call.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", "", false
	}
	switch sel.Sel.Name {
	case "Get", "Post", "Put", "Patch", "Delete":
	default:
		return "", "", false
	}
	lit, ok := call.Args[0].(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", "", false
	}
	ruta, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", "", false
	}
	return ruta, sel.Sel.Name, true
}

// guardasDelGrupo mira los grupos que envuelven a la ruta (los r.Group de chi
// heredan los middlewares de afuera) y dice si alguno usa cada guarda.
func guardasDelGrupo(pila []ast.Node) (admin, sesion bool) {
	for _, n := range pila {
		fn, ok := n.(*ast.FuncLit)
		if !ok {
			continue
		}
		for _, st := range fn.Body.List {
			es, ok := st.(*ast.ExprStmt)
			if !ok {
				continue
			}
			use, ok := es.X.(*ast.CallExpr)
			if !ok || len(use.Args) != 1 {
				continue
			}
			if sel, ok := use.Fun.(*ast.SelectorExpr); !ok || sel.Sel.Name != "Use" {
				continue
			}
			mw, ok := use.Args[0].(*ast.CallExpr)
			if !ok {
				continue
			}
			if sel, ok := mw.Fun.(*ast.SelectorExpr); ok {
				if x, ok := sel.X.(*ast.Ident); ok && x.Name == "middleware" {
					admin = admin || sel.Sel.Name == "RequireAdmin"
					sesion = sesion || sel.Sel.Name == "RequireLiveSession"
				}
			}
		}
	}
	return admin, sesion
}
