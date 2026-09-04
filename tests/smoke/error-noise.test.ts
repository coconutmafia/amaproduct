import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isForeignScriptNoise } from '@/lib/errorNoise'

// Шум чужих скриптов не должен попадать в error_events и Sentry: в промо-дни
// (запуск 02.09) трафик идёт из Instagram, и его встроенный браузер множит
// пустышки пропорционально рекламе — реальные ошибки тонут.

describe('isForeignScriptNoise — чужие инжектированные скрипты', () => {
  it('шум встроенного браузера Instagram (реальные события прода 02.09)', () => {
    // Стек целиком из их «навигационного логгера»
    expect(isForeignScriptNoise(
      'Uncaught Error: Error invoking postMessage: Java object is gone',
      'Error: Error invoking postMessage: Java object is gone\n    at sendDataToNative (iabjs://navigation_performance_logger_android:1:10198)',
    )).toBe(true)
    // Даже без стека формулировка Java-моста Android WebView — не наша
    expect(isForeignScriptNoise(
      'Uncaught Error: Error invoking postMessage: Java exception was raised during method invocation',
    )).toBe(true)
  })

  it('шум крипто-расширений (перенесён из instrumentation-client)', () => {
    expect(isForeignScriptNoise('Failed to connect to MetaMask')).toBe(true)
    expect(isForeignScriptNoise('boom', 'at inject (chrome-extension://abc/inject.js:1:1)')).toBe(true)
  })

  it('НЕ режет настоящие ошибки приложения', () => {
    expect(isForeignScriptNoise('TypeError: Load failed')).toBe(false)
    expect(isForeignScriptNoise('Minified React error #418')).toBe(false)
    expect(isForeignScriptNoise('URL constructor отсутствует — вероятно устаревший in-app браузер')).toBe(false)
    expect(isForeignScriptNoise('Не удалось разобрать ответ анализа. Попробуй ещё раз.')).toBe(false)
    // postMessage сам по себе — легитимное веб-API, режем только Java-мост
    expect(isForeignScriptNoise('Failed to execute postMessage on Window')).toBe(false)
  })

  it('фильтр подключён В ОБЕ половины пайплайна (клиент и приёмник)', () => {
    const client = readFileSync(`${process.cwd()}/instrumentation-client.ts`, 'utf8')
    const server = readFileSync(`${process.cwd()}/app/api/client-error/route.ts`, 'utf8')
    expect(client).toContain('isForeignScriptNoise')
    expect(server).toContain('isForeignScriptNoise')
    // клиент не держит собственную копию списка — одна правда в lib/errorNoise
    expect(client).not.toContain('EXTENSION_NOISE')
  })
})

describe('перегруз Anthropic в чате — тихий повтор вместо «Ошибки» (04.09)', () => {
  it('чат ретраит overloaded до 2 раз, только пока раунд не начал отдавать текст', () => {
    const src = readFileSync(`${process.cwd()}/app/api/ai/chat/route.ts`, 'utf8')
    expect(src).toContain('overloaded_error|Overloaded')
    expect(src).toContain('attempt < 2')
    // повтор безопасен только для пустого раунда — иначе задвоится текст
    expect(src).toContain('acc.length === roundStart')
    // и рефанд юнита при полном провале никуда не делся
    expect(src).toContain('onEmptyError')
  })
})
