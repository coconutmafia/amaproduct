// Сохранение файлов, которое переживает Telegram-webview, iOS-PWA и Safari
// с попап-блокером (инцидент 20.08, Полина Назарова: blob + <a download> и
// window.open молча умирают во встроенных браузерах; юзеры AVA — мобильные,
// приходят по ссылкам из Telegram или с ярлыка «на рабочем столе»).
//
// Два пути:
//  • ТЕКСТОВЫЕ файлы (csv/md/txt), собранные на клиенте → downloadTextViaServer:
//    скрытая форма POST на /api/download-text, сервер отвечает attachment —
//    top-level навигацию с Content-Disposition обрабатывает ЛЮБОЙ браузер и
//    webview («Сохранить/Поделиться»), страница при этом не перезагружается.
//  • БИНАРНЫЕ (отрендеренные PNG слайдов, ZIP) → saveBlobSmart: сначала
//    системный share-sheet (navigator.share с файлом — родной путь на iOS,
//    работает и в webview), фолбэк — классический <a download> (десктоп,
//    Android-браузеры).

export function downloadTextViaServer(filename: string, mime: string, content: string): void {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/download-text'
  form.style.display = 'none'
  for (const [name, value] of [['filename', filename], ['mime', mime], ['content', content]]) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  // Ответ — attachment: браузер остаётся на странице, форму можно убрать
  setTimeout(() => form.remove(), 2000)
}

export async function saveBlobSmart(name: string, blob: Blob): Promise<void> {
  // 1) Родной share-sheet (iOS Safari/webview/PWA, современный Android):
  //    оттуда доступны «Сохранить в Фото/Файлы», мессенджеры и т.д.
  try {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' })
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[] }) => Promise<void> }
    if (typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file] })
      return
    }
  } catch (e) {
    // Юзер закрыл share-sheet — это не ошибка и не повод качать второй раз
    if (e instanceof Error && e.name === 'AbortError') return
    // остальное — падаем в фолбэк
  }
  // 2) Классика для десктопа/Android
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
