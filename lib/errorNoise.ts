// Шум ЧУЖИХ скриптов в отчётах об ошибках — не наш код, юзер ничего не видит.
// Один предикат на обе точки пайплайна (обе половины класса):
//  • клиент (instrumentation-client.ts) — новые бандлы не шлют шум ни в Sentry,
//    ни в /api/client-error;
//  • сервер (app/api/client-error/route.ts) — старые бандлы из кэша браузеров
//    ещё какое-то время шлют, приёмник их не пишет в error_events.
//
// Зачем: /admin/errors и Sentry должны оставаться высокосигнальными — реальную
// ошибку (вебхук Продамуса, упавший джоб) нельзя искать среди сотен пустышек.
// Особенно в промо-дни, когда трафик идёт из Instagram и шум его встроенного
// браузера множится пропорционально рекламе.

// Браузерные расширения: крипто-кошельки (MetaMask, Phantom, …) инжектятся в
// каждую страницу и кидают свои ошибки подключения. Web3-фичи у нас нет —
// эти слова не могут быть настоящей ошибкой приложения.
const EXTENSION_NOISE = /metamask|ethereum|web3|wallet|solana|phantom|coinbase|chrome-extension:\/\/|moz-extension:\/\/|safari-web-extension:\/\//i

// Встроенные браузеры (in-app): Instagram/Facebook на Android инжектят свой
// «navigation_performance_logger» (стек с iabjs://), который на закрытии
// страницы стучится в уже убитый Java-мост и кидает «Error invoking
// postMessage: Java object is gone / Java exception was raised». Зафиксировано
// на проде 02.09 (UA: Instagram … IABMV/1) — наш код Java-мосты не вызывает,
// формулировка принадлежит Android WebView JavaBridge.
const INAPP_BROWSER_NOISE = /iabjs:\/\/|Error invoking postMessage: Java/i

/** true — ошибка порождена чужим инжектированным скриптом, в журнал не писать. */
export function isForeignScriptNoise(message: string, stack?: string): boolean {
  const m = message || ''
  const s = stack || ''
  return (
    EXTENSION_NOISE.test(m) || EXTENSION_NOISE.test(s) ||
    INAPP_BROWSER_NOISE.test(m) || INAPP_BROWSER_NOISE.test(s)
  )
}
