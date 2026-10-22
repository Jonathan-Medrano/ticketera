import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MARKETING_EMAIL_FMT,
  buildStructuredContent,
  serializeStructuredContent,
  parseStructuredContent,
  isStructuredContent,
  renderMarketingEmailHtml,
} from './lib/marketing-email-template'

test('buildStructuredContent normaliza y filtra párrafos vacíos', () => {
  const c = buildStructuredContent({
    titulo: '  Hola  ',
    parrafos: ['  uno  ', '', '   ', 'dos'],
    imagen_url: 'https://x.com/a.png',
    boton: { texto: ' Ver ', url: 'https://x.com' },
  })
  assert.equal(c._fmt, MARKETING_EMAIL_FMT)
  assert.equal(c.titulo, 'Hola')
  assert.deepEqual(c.parrafos, ['uno', 'dos'])
  assert.equal(c.imagen_url, 'https://x.com/a.png')
  assert.deepEqual(c.boton, { texto: 'Ver', url: 'https://x.com' })
})

test('buildStructuredContent rechaza contenido vacío', () => {
  assert.throws(() => buildStructuredContent({ titulo: '', parrafos: [] }), /al menos un título o un párrafo/)
})

test('buildStructuredContent rechaza url de botón no http', () => {
  assert.throws(
    () => buildStructuredContent({ parrafos: ['x'], boton: { texto: 'Ir', url: 'javascript:alert(1)' } }),
    /http/,
  )
})

test('buildStructuredContent rechaza imagen con esquema peligroso', () => {
  assert.throws(
    () => buildStructuredContent({ parrafos: ['x'], imagen_url: 'javascript:alert(1)' }),
    /imagen no es válida/,
  )
})

test('serialize/parse round-trip', () => {
  const c = buildStructuredContent({ titulo: 'T', parrafos: ['p1'] })
  const stored = serializeStructuredContent(c)
  assert.equal(isStructuredContent(stored), true)
  const parsed = parseStructuredContent(stored)
  assert.deepEqual(parsed, c)
})

test('isStructuredContent: legacy HTML no es estructurado', () => {
  assert.equal(isStructuredContent('<h1>Hola</h1>'), false)
  assert.equal(isStructuredContent(''), false)
  assert.equal(isStructuredContent('{"foo":1}'), false)
})

test('render escapa HTML del usuario (anti-XSS)', () => {
  const stored = serializeStructuredContent(
    buildStructuredContent({ titulo: '<script>alert(1)</script>', parrafos: ['<img onerror=x>'] }),
  )
  const html = renderMarketingEmailHtml(stored)
  assert.equal(html.includes('<script>'), false)
  assert.equal(html.includes('&lt;script&gt;'), true)
  // El "img onerror" del usuario queda como texto inerte escapado, no como tag real.
  assert.equal(html.includes('<img onerror'), false)
  assert.equal(html.includes('&lt;img onerror=x&gt;'), true)
})

test('render reemplaza {{nombre}} por destinatario', () => {
  const stored = serializeStructuredContent(buildStructuredContent({ parrafos: ['Hola {{nombre}}!'] }))
  assert.equal(renderMarketingEmailHtml(stored, { nombre: 'Ana' }).includes('Hola Ana!'), true)
  // Sin nombre, el token se remueve limpio.
  assert.equal(renderMarketingEmailHtml(stored).includes('{{nombre}}'), false)
})

test('render arma título, párrafos, imagen y botón', () => {
  const stored = serializeStructuredContent(
    buildStructuredContent({
      titulo: 'Titulo',
      parrafos: ['P1', 'P2'],
      imagen_url: 'https://x.com/a.png',
      boton: { texto: 'Ver evento', url: 'https://x.com/e' },
    }),
  )
  const html = renderMarketingEmailHtml(stored)
  assert.match(html, /<h1[^>]*>Titulo<\/h1>/)
  assert.match(html, /<p[^>]*>P1<\/p>/)
  assert.match(html, /<img src="https:\/\/x\.com\/a\.png"/)
  assert.match(html, /<a href="https:\/\/x\.com\/e"[^>]*>Ver evento<\/a>/)
})

test('render passthrough para HTML legacy', () => {
  assert.equal(renderMarketingEmailHtml('<h1>Legacy</h1>'), '<h1>Legacy</h1>')
})
