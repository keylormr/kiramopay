package lightning

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// Los vectores son los ejemplos de BOLT 11 (lightning/bolts,
// 11-payment-encoding.md), con el desglose que el propio documento da de cada
// uno.

const (
	hashDeLosEjemplos = "0001020304050607080900010203040506070809000102030405060708090102"

	// "Please make a donation of any amount": sin monto, sin x.
	facturaDonacion = "lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql"

	// "Please send $3 for a cup of coffee ... within one minute": 2500u, x = 60.
	facturaCafe = "lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh"

	// "Now send $24 for an entire list of things (hashed)": 20m, descripcion hasheada.
	facturaHasheada = "lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44"

	// "Please send 0.00967878534 BTC ... amount in pico-BTC": x = 604800.
	facturaPico = "lnbc9678785340p1pwmna7lpp5gc3xfm08u9qy06djf8dfflhugl6p7lgza6dsjxq454gxhj9t7a0sd8dgfkx7cmtwd68yetpd5s9xar0wfjn5gpc8qhrsdfq24f5ggrxdaezqsnvda3kkum5wfjkzmfqf3jkgem9wgsyuctwdus9xgrcyqcjcgpzgfskx6eqf9hzqnteypzxz7fzypfhg6trddjhygrcyqezcgpzfysywmm5ypxxjemgw3hxjmn8yptk7untd9hxwg3q2d6xjcmtv4ezq7pqxgsxzmnyyqcjqmt0wfjjq6t5v4khxsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsxqyjw5qcqp2rzjq0gxwkzc8w6323m55m4jyxcjwmy7stt9hwkwe2qxmy8zpsgg7jcuwz87fcqqeuqqqyqqqqlgqqqqn3qq9q9qrsgqrvgkpnmps664wgkp43l22qsgdw4ve24aca4nymnxddlnp8vh9v2sdxlu5ywdxefsfvm0fq3sesf08uf6q9a2ke0hc9j6z6wlxg5z5kqpu2v9wz"

	// "Same, but all upper case." (25m).
	facturaMayusculas = "LNBC25M1PVJLUEZPP5QQQSYQCYQ5RQWZQFQQQSYQCYQ5RQWZQFQQQSYQCYQ5RQWZQFQYPQDQ5VDHKVEN9V5SXYETPDEESSP5ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYG3ZYGS9Q5SQQQQQQQQQQQQQQQQSGQ2A25DXL5HRNTDTN6ZVYDT7D66HYZSYHQS4WDYNAVYS42XGL6SGX9C4G7ME86A27T07MDTFRY458RTJR0V92CNMSWPSJSCGT2VCSE3SGPZ3UAPA"

	// "The same, on testnet, with a fallback address".
	facturaTestnet = "lntb20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygshp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfpp3x9et2e20v6pu37c5d9vax37wxq72un989qrsgqdj545axuxtnfemtpwkc45hx9d2ft7x04mt8q7y6t0k2dge9e7h8kpy9p34ytyslj3yu569aalz2xdk8xkd7ltxqld94u8h2esmsmacgpghe9k8"
)

func TestDecodificarFactura_LosEjemplosDeBolt11(t *testing.T) {
	fechaDeLosEjemplos := time.Unix(1496314658, 0).UTC()
	casos := []struct {
		nombre      string
		factura     string
		red         string
		msat        int64
		fecha       time.Time
		vence       time.Duration
		hash        string
		descripcion string
		hashDesc    string
	}{
		{"donacion sin monto", facturaDonacion, "bc", 0, fechaDeLosEjemplos, time.Hour, hashDeLosEjemplos,
			"Please consider supporting this project", ""},
		{"cafe de 2500u con x=60", facturaCafe, "bc", 250_000_000, fechaDeLosEjemplos, time.Minute, hashDeLosEjemplos,
			"1 cup coffee", ""},
		{"20m con descripcion hasheada", facturaHasheada, "bc", 2_000_000_000, fechaDeLosEjemplos, time.Hour, hashDeLosEjemplos,
			"", "3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1"},
		{"pico-bitcoin con x=604800", facturaPico, "bc", 967_878_534, time.Unix(1572468703, 0).UTC(), 604800 * time.Second,
			"462264ede7e14047e9b249da94fefc47f41f7d02ee9b091815a5506bc8abf75f", "", ""},
		{"toda en mayusculas, como en un QR", facturaMayusculas, "bc", 2_500_000_000, fechaDeLosEjemplos, time.Hour, hashDeLosEjemplos,
			"coffee beans", ""},
		{"con el esquema lightning: delante", "LIGHTNING:" + facturaMayusculas, "bc", 2_500_000_000, fechaDeLosEjemplos, time.Hour,
			hashDeLosEjemplos, "coffee beans", ""},
		{"testnet", facturaTestnet, "tb", 2_000_000_000, fechaDeLosEjemplos, time.Hour, hashDeLosEjemplos,
			"", "3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f, err := DecodificarFactura(c.factura)
			if err != nil {
				t.Fatalf("no se leyo: %v", err)
			}
			if f.Red != c.red {
				t.Errorf("red = %q, quiero %q", f.Red, c.red)
			}
			if f.MontoMsat != c.msat {
				t.Errorf("msat = %d, quiero %d", f.MontoMsat, c.msat)
			}
			if !f.Fecha.Equal(c.fecha) {
				t.Errorf("fecha = %v, quiero %v", f.Fecha, c.fecha)
			}
			if got := f.Vence.Sub(f.Fecha); got != c.vence {
				t.Errorf("plazo = %v, quiero %v", got, c.vence)
			}
			if f.PaymentHash != c.hash {
				t.Errorf("payment hash = %s, quiero %s", f.PaymentHash, c.hash)
			}
			if c.descripcion != "" && f.Descripcion != c.descripcion {
				t.Errorf("descripcion = %q, quiero %q", f.Descripcion, c.descripcion)
			}
			if f.DescripcionHash != c.hashDesc {
				t.Errorf("hash de la descripcion = %q, quiero %q", f.DescripcionHash, c.hashDesc)
			}
		})
	}
}

// Las facturas invalidas de BOLT 11 que este lector tiene que rechazar. No se
// incluyen las que dependen de verificar la firma o los bits de funciones: el
// servidor no las paga, solo lee monto y hash de una factura que le entrego el
// servidor de la direccion por TLS.
func TestDecodificarFactura_RechazaLasInvalidasDeBolt11(t *testing.T) {
	casos := []struct{ nombre, factura string }{
		{"campo n de largo invalido",
			"lnbc25m1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5vdhkven9v5sxyetpdeessp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9q5sqqqqqqqqqqqqqqqqsgqnp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqf9dt6rzhc3ynq3u7axf4xc3zaw3fy2kyqal6n86nh5j3lhgcutdjzhvswudd5l8ay9acgrrpd2e6vw9sdqxq6dzq983sgt7dpxk5wacqacdc2y"},
		{"sin p",
			"lnbc25m1pvjluezdq5vdhkven9v5sxyetpdeessp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9q5sqqqqqqqqqqqqqqqqsgqjy08jd52dtj25pefkh0enc54lxtjtr8wnum2msrq2d8uztp9vhhpccq93ljpff0kkjgzkzcp2czlyenjphf6upazjlc8uxw7za0ynusqrfhg8u"},
		{"dos p distintos",
			"lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqpp5lllllllllllllllllllllllllllllllllllllllllllllllllllsdpyv36hqmrfvdshgefqwpshjmt9de6zq6rpwd5qsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9g3f93cqturay6zk2fyfcmeflphlzew9wfq0n5nf9hqnlwxthtzqcljcuurljyd2vngkya5hndakf33ghly97qm5nc3umj7jep22nfsq3nr0w8"},
		{"el mismo p dos veces",
			"lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpyv36hqmrfvdshgefqwpshjmt9de6zq6rpwd5qsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs29wywgsx0wpv9t045f683nj97nnjk55wt0exe3eassl6smx60nk9hlaae8vhe0hwv25s6fthcwqkxsw2hpjeptxz7xujtexa3l8jrkcqyn037r"},
		{"dos s distintos",
			"lnbc25m1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5vdhkven9v5sxyetpdeessp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygssp5yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3q9q5sqqqqqqqqqqqqqqqqsgqy23f0q2mhf0mnhfesz2lt3j9n8negrgr2a7wd554fppeqnvwz9749j2zmp2jd2sfvn3lzlajhalyxlv2h6ccs6p3yg7wg43y22cazccp5vkkte"},
		{"suma de control invalida",
			"lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrnt"},
		{"sin separador",
			"pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrny"},
		{"mayusculas mezcladas",
			"LNBC2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpquwpc4curk03c9wlrswe78q4eyqc7d8d0xqzpuyk0sg5g70me25alkluzd2x62aysf2pyy8edtjeevuv4p2d5p76r4zkmneet7uvyakky2zr4cusd45tftc9c5fh0nnqpnl2jfll544esqchsrny"},
		{"demasiado corta",
			"lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6na6hlh"},
		{"multiplicador invalido",
			"lnbc2500x1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgqrrzc4cvfue4zp3hggxp47ag7xnrlr8vgcmkjxk3j5jqethnumgkpqp23z9jclu3v0a7e0aruz366e9wqdykw6dxhdzcjjhldxq0w6wgqcnu43j"},
		{"fraccion de milisatoshi",
			"lnbc2500000001p1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpusp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygs9qrsgq0lzc236j96a95uv0m3umg28gclm5lqxtqqwk32uuk4k6673k6n5kfvx3d2h8s295fad45fdhmusm8sjudfhlf6dcsxmfvkeywmjdkxcp99202x"},
		{"sin s",
			"lnbc20m1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp49qdkj"},
		{"vacia", ""},
		{"otra cosa", "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f, err := DecodificarFactura(c.factura)
			if err == nil {
				t.Fatalf("se acepto una factura invalida: %+v", f)
			}
			if !errors.Is(err, ErrFacturaInvalida) {
				t.Errorf("el error no es ErrFacturaInvalida: %v", err)
			}
		})
	}
}

func TestDecodificarFactura_AceptaEspaciosAlrededor(t *testing.T) {
	f, err := DecodificarFactura("  " + strings.ToUpper(facturaCafe) + "\n")
	if err != nil || f.MontoMsat != 250_000_000 {
		t.Fatalf("f=%+v err=%v", f, err)
	}
}
