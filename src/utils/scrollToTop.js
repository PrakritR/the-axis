export default function scrollToTop() {
  const scrollingElement = document.scrollingElement || document.documentElement

  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })

  if (scrollingElement) {
    scrollingElement.scrollTop = 0
    scrollingElement.scrollLeft = 0
  }

  document.documentElement.scrollTop = 0
  document.documentElement.scrollLeft = 0
  document.body.scrollTop = 0
  document.body.scrollLeft = 0

  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  })
}