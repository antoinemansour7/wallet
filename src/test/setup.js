import '@testing-library/jest-dom'

// pdfjs-dist references DOMMatrix at module-load time; stub it for jsdom
if (typeof DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0 }
  }
}

// jsdom 26 is the last release that runs on the Node 20 version used by CI,
// but its File implementation predates the standard text() convenience API.
if (typeof File !== 'undefined' && typeof File.prototype.text !== 'function') {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
        reader.addEventListener('error', () => reject(reader.error))
        reader.readAsText(this)
      })
    },
  })
}
