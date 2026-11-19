// Unit tests for src/image-source.ts: `npm test` (node --test; Node 24 loads the
// TypeScript source directly).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { imageSource, svgDataUrl, viewBoxSize } from '../src/image-source.ts'

// Stands in for the browser's DOMParser + XMLSerializer: returns the markup as is.
const asIs = (markup) => ({ xml: markup, viewBox: markup.match(/viewBox="([^"]*)"/)?.[1] ?? null })

const decode = (src) => decodeURIComponent(src.slice(src.indexOf(',') + 1))

test('inline SVG becomes an image address with its viewBox size', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="10" height="10"/></svg>'
    const source = imageSource(svg, asIs)
    assert.ok(source.src.startsWith('data:image/svg+xml;charset=utf-8,'))
    assert.equal(decode(source.src), svg)
    assert.equal(source.width, 200)
    assert.equal(source.height, 100)
})

test('inline SVG after an XML declaration, a doctype or a byte order mark is found', () => {
    const svg = '<svg viewBox="0 0 4 3"></svg>'
    for (const image of [`<?xml version="1.0"?>\n${svg}`, `<!DOCTYPE svg>${svg}`, `﻿${svg}`, `  ${svg}  `]) {
        const source = imageSource(image, asIs)
        assert.equal(decode(source.src), svg, JSON.stringify(image))
        assert.deepEqual([source.width, source.height], [4, 3])
    }
})

test('inline SVG markup reaches the serializer and never comes back as markup', () => {
    let seen
    const source = imageSource('<SVG><g/></SVG>', (markup) => {
        seen = markup
        return { xml: '<svg xmlns="http://www.w3.org/2000/svg"/>', viewBox: null }
    })
    assert.equal(seen, '<SVG><g/></SVG>')
    assert.deepEqual(source, { src: svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>') })
    assert.equal(imageSource('<svg></svg>', () => undefined), undefined)
})

test('viewBoxSize reads width and height and refuses unusable values', () => {
    assert.deepEqual(viewBoxSize('0 0 200 100'), { width: 200, height: 100 })
    assert.deepEqual(viewBoxSize(' -5,-5, 10.5 , 7 '), { width: 10.5, height: 7 })
    for (const value of [null, undefined, '', '0 0 200', '0 0 0 100', '0 0 -1 1', '0 0 a b', '0 0 1 1 1']) {
        assert.equal(viewBoxSize(value), undefined, JSON.stringify(value))
    }
})

test('addresses and encoded images pass unchanged', () => {
    const png = `data:image/png;base64,${'A'.repeat(20)}`
    const svgUrl = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E'
    const base64 = 'A'.repeat(120)
    assert.deepEqual(imageSource('https://example.com/plan.png', asIs), { src: 'https://example.com/plan.png' })
    assert.deepEqual(imageSource(' /files/plan.png ', asIs), { src: '/files/plan.png' })
    assert.deepEqual(imageSource('./plan.png', asIs), { src: './plan.png' })
    assert.deepEqual(imageSource(png, asIs), { src: png })
    assert.deepEqual(imageSource(svgUrl, asIs), { src: svgUrl })
    assert.deepEqual(imageSource(base64, asIs), { src: `data:image/*;base64,${base64}` })
})

test('nothing to draw gives undefined', () => {
    for (const value of [undefined, null, '', 42, {}, [], 'plan.png', 'not an image']) {
        assert.equal(imageSource(value, asIs), undefined, JSON.stringify(value))
    }
})

test('the component draws the background only through an <img>', () => {
    const component = readFileSync(new URL('../src/widget-overlay.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(component, /unsafe-svg|unsafe-html|unsafeSVG|unsafeHTML|innerHTML/)
    assert.match(component, /imageSource\(this\.inputData\?\.image, serializeSvg\)/)
})
