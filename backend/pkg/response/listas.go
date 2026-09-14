package response

import "reflect"

// listaVaciaSiNil convierte una lista nil en una lista vacia del mismo tipo.
//
// En Go, `var grupos []Grupo` sin filas es un slice nil, y encoding/json lo
// escribe como `null`. La respuesta quedaba `{"success":true,"data":null}` y
// la pantalla, que espera un arreglo, lo tomaba por un fallo: "no pudimos
// cargar tus cuentas divididas" a quien simplemente no tenia ninguna. El mismo
// `var x []T` se repite en decenas de repositorios, asi que se corrige en el
// unico punto por el que pasan todas las respuestas en vez de lista por lista.
//
// Solo toca listas. Un nil sin tipo sigue omitiendo `data`, y un mapa o un
// puntero nil siguen saliendo como `null`: ahi "no hay nada" no es lo mismo
// que "no hay filas".
func listaVaciaSiNil(data interface{}) interface{} {
	if data == nil {
		return nil
	}
	v := reflect.ValueOf(data)
	if v.Kind() == reflect.Slice && v.IsNil() {
		return reflect.MakeSlice(v.Type(), 0, 0).Interface()
	}
	return data
}
