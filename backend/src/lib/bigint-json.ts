/**
 * Serializacion JSON de BigInt.
 *
 * Postgres devuelve `bigint` para COUNT/SUM (pueden superar 2^53) y
 * `JSON.stringify` no sabe serializarlo: tira
 * "TypeError: Do not know how to serialize a BigInt".
 *
 * Este modulo existe como archivo aparte a proposito. El polyfill vivia SOLO
 * dentro de `src/index.ts`, el entrypoint del servidor. Los tests montan los
 * routers directamente (`app.use('/api/x', xRouter)`) sin pasar por
 * `index.ts`, asi que corrian SIN el polyfill: cualquier endpoint con un COUNT
 * devolvia 500 en los tests y 200 en produccion.
 *
 * Un test que corre con un runtime distinto al de produccion no esta probando
 * produccion. Por eso ahora lo importan los dos: `index.ts` y `test-env.ts`.
 *
 * Precision: se pierde para valores > 2^53, pero ningun COUNT realista de esta
 * plataforma se acerca a eso.
 */
export function installBigIntJsonSerializer() {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number }
  if (typeof proto.toJSON === 'function') return
  proto.toJSON = function (this: bigint) {
    return Number(this)
  }
}

installBigIntJsonSerializer()
