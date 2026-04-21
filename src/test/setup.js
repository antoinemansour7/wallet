import '@testing-library/jest-dom'

// pdfjs-dist references DOMMatrix at module-load time; stub it for jsdom
if (typeof DOMMatrix === 'undefined') {
  global.DOMMatrix = class DOMMatrix {
    constructor() { this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0 }
  }
}
