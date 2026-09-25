import { describe, expect, test } from 'vitest'
import { classifyInput, matchLessons, buildReplyA } from './chatEngine'
import type { Lesson, TextVerdict, UrlVerdict } from './types'

test('url', () => expect(classifyInput('mercad0pago.com.ar')).toBe('url'))
test('url with scheme', () => expect(classifyInput('https://bit.ly/x')).toBe('url'))
test('question', () => expect(classifyInput('¿Es seguro pagar con QR?')).toBe('question'))
test('message', () =>
  expect(
    classifyInput('Tu cuenta será suspendida, ingresá tu clave en http://x.xyz'),
  ).toBe('text'))
test('lesson match ignores accents', () => {
  const ls = [
    {
      id: 'credential_request',
      title: 'Te piden tu clave o código',
      icon: '',
      how_to_spot: '',
      example: '',
      what_to_do: '',
    },
  ]
  expect(matchLessons('que hago si me piden el codigo', ls as any)[0].id).toBe(
    'credential_request',
  )
})

describe('classifyInput edge cases', () => {
  test('empty input is text', () => expect(classifyInput('')).toBe('text'))
  test('plain host without scheme', () =>
    expect(classifyInput('bna-homebanking-verificar.xyz')).toBe('url'))
  test('question word without accent mark still detected', () =>
    expect(classifyInput('como se yo si es una estafa')).toBe('question'))
})

describe('matchLessons', () => {
  const lessons: Lesson[] = [
    {
      id: 'urgency',
      icon: '⏰',
      title: 'Te apuran para que no pienses',
      how_to_spot: 'Mensajes con plazos cortísimos',
      example: 'Tu cuenta será suspendida hoy',
      what_to_do: 'Tomate tu tiempo, nadie te apura si es real',
    },
    {
      id: 'prize',
      icon: '🎁',
      title: 'Te avisan que ganaste algo',
      how_to_spot: 'Premios o sorteos que no jugaste',
      example: 'Ganaste un premio, reclamalo ya',
      what_to_do: 'Desconfiá de premios inesperados',
    },
  ]

  test('falls back to first N lessons when nothing overlaps', () => {
    const result = matchLessons('hola que tal como estas', lessons, 1)
    expect(result).toHaveLength(1)
  })

  test('respects the requested limit', () => {
    const result = matchLessons('premios sorteos inesperados jugaste', lessons, 1)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('prize')
  })
})

describe('buildReplyA', () => {
  const baseUrlVerdict: UrlVerdict = {
    url: 'http://bna-homebanking-verificar.xyz',
    level: 'danger',
    score: 0.9,
    category: 'suspicious_domain',
    reasons: ['El sitio imita a un banco pero no es su dirección oficial.'],
    tip: 'No ingreses tus datos ahí.',
    ml: { probability: 0.9, threshold: 0.5, flagged: true, top_features: [] },
    rules: [{ id: 'fake_domain', weight: 0.5 }],
    details: { blacklist: false, whitelist: false, ml_probability: 0.9 },
  }

  const textVerdict: TextVerdict = {
    level: 'safe',
    score: 0,
    category: 'none',
    reasons: [],
    tip: 'Todo bien.',
    signals: [],
    lessons: [],
    urls: [],
  }

  test('danger url renders the word Peligroso, not only color', () => {
    const reply = buildReplyA(baseUrlVerdict)
    expect(reply.word).toBe('Peligroso')
    expect(reply.icon).toBe('⛔')
    expect(reply.level).toBe('danger')
  })

  test('safe text renders the word Parece seguro', () => {
    const reply = buildReplyA(textVerdict)
    expect(reply.word).toBe('Parece seguro')
    expect(reply.icon).toBe('✅')
  })

  test('always includes quick chips', () => {
    const reply = buildReplyA(textVerdict)
    expect(reply.chips.length).toBeGreaterThan(0)
  })

  test('summary is a level-based sentence, not the first reason repeated', () => {
    const reply = buildReplyA(baseUrlVerdict)
    expect(reply.reasons).toEqual(baseUrlVerdict.reasons)
    expect(reply.summary).not.toBe(reply.reasons[0])
    expect(reply.summary).toBe(
      'Esto tiene señales claras de estafa. No ingreses datos ni hagas clic.',
    )
  })

  test('caution and safe summaries use their own level sentence', () => {
    const caution = buildReplyA({ ...baseUrlVerdict, level: 'caution' })
    expect(caution.summary).toBe('Hay señales sospechosas. Revisalo con calma antes de seguir.')
    const safe = buildReplyA(textVerdict)
    expect(safe.summary).toBe('No encontramos señales de estafa, pero siempre conviene revisar.')
    expect(safe.summary).not.toBe(safe.reasons[0])
  })

  test('maps url category to a lesson id when a catalog is given', () => {
    const catalog: Lesson[] = [
      {
        id: 'fake_domain',
        icon: '🔗',
        title: 'Direcciones parecidas pero falsas',
        how_to_spot: 'Letras cambiadas o dominios raros',
        example: 'bna-homebanking-verificar.xyz',
        what_to_do: 'Escribí vos la dirección oficial',
      },
    ]
    const reply = buildReplyA(baseUrlVerdict, catalog)
    expect(reply.lessons.map((l) => l.id)).toContain('fake_domain')
  })
})
