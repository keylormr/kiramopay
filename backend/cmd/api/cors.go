package main

import "github.com/go-chi/cors"

// opcionesCORS arma la politica CORS del API.
//
// AllowedHeaders tiene que listar TODA cabecera que el frontend mande de verdad
// en una peticion entre dominios (kiramopay.com -> api.kiramopay.com, y la app
// Android desde su propio origen). go-chi/cors, como rs/cors, no descarta solo la
// cabecera que falta: en cuanto una sola de las pedidas en el preflight no esta
// en la lista, responde el OPTIONS sin NINGUNA cabecera Access-Control-Allow-*
// (handlePreflight, "Preflight aborted: headers not allowed") y el navegador
// bloquea la peticion real. Asi estuvieron rotos el deposito y el retiro de las
// metas de ahorro, que mandan Idempotency-Key desde
// src/api/adapters/http/savings.http.ts.
func opcionesCORS(origenes []string) cors.Options {
	return cors.Options{
		AllowedOrigins:   origenes,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Idempotency-Key", "X-Kiramopay-Dev"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}
}
