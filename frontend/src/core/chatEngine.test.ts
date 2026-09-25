import { describe, expect, test } from 'vitest'
import {
  classifyInput,
  matchLessons,
  buildReplyA,
  CATEGORY_TO_LESSON_ID,
  isAlreadyScammedTrigger,
  containsUrl,
  DANGER_RECOVERY_CHIP,
} from './chatEngine'
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
    details: { blacklist: false, whitelist: false, ml_probability: 0.9, reputation: 'unavailable' },
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

  test('maps the pirate-streaming and reputation categories to their lesson ids', () => {
    expect(CATEGORY_TO_LESSON_ID.risky_site).toBe('risky_streaming')
    expect(CATEGORY_TO_LESSON_ID.malicious).toBe('malicious_site')
  })

  test('risky_site url verdict resolves the risky_streaming lesson from the catalog', () => {
    const catalog: Lesson[] = [
      {
        id: 'risky_streaming',
        icon: '⚽',
        title: 'Sitios de fútbol o series gratis',
        how_to_spot: 'Botones de Ver falsos y publicidad engañosa',
        example: 'futbollibrefullhd.org',
        what_to_do: 'No hagas clic en los botones de Ver',
      },
    ]
    const reply = buildReplyA({ ...baseUrlVerdict, category: 'risky_site' }, catalog)
    expect(reply.lessons.map((l) => l.id)).toContain('risky_streaming')
  })

  test('malicious url verdict resolves the malicious_site lesson from the catalog', () => {
    const catalog: Lesson[] = [
      {
        id: 'malicious_site',
        icon: '☠️',
        title: 'Sitios marcados como peligrosos',
        how_to_spot: 'Google ya lo identificó como fuente de virus',
        example: 'Chrome muestra una advertencia roja',
        what_to_do: 'No ingreses ni sigas navegando ahí',
      },
    ]
    const reply = buildReplyA({ ...baseUrlVerdict, category: 'malicious' }, catalog)
    expect(reply.lessons.map((l) => l.id)).toContain('malicious_site')
  })

  test('a danger verdict adds the recovery chip on top of the quick chips', () => {
    const reply = buildReplyA(baseUrlVerdict)
    expect(reply.chips).toContain(DANGER_RECOVERY_CHIP)
    expect(reply.chips.length).toBeGreaterThan(2)
  })

  test('caution and safe verdicts show no recovery chip', () => {
    const caution = buildReplyA({ ...baseUrlVerdict, level: 'caution' })
    expect(caution.chips).not.toContain(DANGER_RECOVERY_CHIP)
    const safe = buildReplyA(textVerdict)
    expect(safe.chips).not.toContain(DANGER_RECOVERY_CHIP)
  })
})

describe('isAlreadyScammedTrigger', () => {
  const positives = [
    'ya puse mis datos',
    'Ya puse mis datos en la página',
    'me estafaron',
    'Me ESTAFARON con un link',
    'caí en una estafa',
    'cai en una estafa por WhatsApp',
    'me robaron la cuenta',
    'me robaron el whatsapp',
    'les pasé el código',
    'le pasé el código de la app',
    'ya hice la transferencia',
    'me hackearon',
  ]

  for (const phrase of positives) {
    test(`detects "${phrase}"`, () => {
      expect(isAlreadyScammedTrigger(phrase)).toBe(true)
    })
  }

  const negatives = [
    '¿Cómo me doy cuenta de una estafa?',
    '¿Es seguro pagar con QR?',
    'como se yo si es una estafa',
    'mercad0pago.com.ar',
    '¿Qué hago si me piden el código?',
  ]

  for (const phrase of negatives) {
    test(`does not trigger on "${phrase}"`, () => {
      expect(isAlreadyScammedTrigger(phrase)).toBe(false)
    })
  }
})

describe('containsUrl', () => {
  test('detects a url inside a longer message', () => {
    expect(containsUrl('ya puse mis datos en http://mercadopago-reintegros.com')).toBe(true)
  })
  test('plain phrase has no url', () => {
    expect(containsUrl('ya puse mis datos')).toBe(false)
  })
})
