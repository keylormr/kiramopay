package config

import "testing"

var variablesDePlanes = []string{
	"PLAN_METAS_FREE", "PLAN_METAS_PLUS", "PLAN_METAS_PRO",
	"PLAN_TARJETAS_FREE", "PLAN_TARJETAS_PLUS", "PLAN_TARJETAS_PRO",
}

func TestLoad_TopesDePlanPorDefecto(t *testing.T) {
	for _, k := range variablesDePlanes {
		t.Setenv(k, "")
	}
	quiero := PlanesConfig{
		MetasFree: 3, MetasPlus: 10, MetasPro: 0,
		TarjetasFree: 1, TarjetasPlus: 3, TarjetasPro: 5,
	}
	if got := Load().Planes; got != quiero {
		t.Fatalf("topes = %+v, se esperaba %+v", got, quiero)
	}
}

// Un negativo es un error de tipeo y vale el de fabrica: recortarlo a 0 le
// regalaria "sin tope" a todo el plan.
func TestLoad_UnTopeNegativoNoRegalaElIlimitado(t *testing.T) {
	for _, k := range variablesDePlanes {
		t.Setenv(k, "")
	}
	t.Setenv("PLAN_METAS_FREE", "-1")
	t.Setenv("PLAN_TARJETAS_PRO", "-5")
	t.Setenv("PLAN_METAS_PLUS", "0")
	t.Setenv("PLAN_TARJETAS_FREE", "2")
	t.Setenv("PLAN_METAS_PRO", "abc")

	p := Load().Planes
	if p.MetasFree != 3 || p.TarjetasPro != 5 {
		t.Errorf("negativos: metas free %d, tarjetas pro %d; se esperaban los de fabrica 3 y 5", p.MetasFree, p.TarjetasPro)
	}
	if p.MetasPlus != 0 {
		t.Errorf("un 0 explicito es sin tope: metas plus = %d", p.MetasPlus)
	}
	if p.TarjetasFree != 2 {
		t.Errorf("tarjetas free = %d, se esperaba 2", p.TarjetasFree)
	}
	if p.MetasPro != 0 {
		t.Errorf("un valor que no es numero vale el de fabrica: metas pro = %d", p.MetasPro)
	}
}
