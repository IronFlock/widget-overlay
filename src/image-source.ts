/**
 * The background image to draw: the address for the `<img>`, and for inline SVG
 * markup the size of its viewBox, which the overlays are scaled against.
 */
export type ImageSource = { src: string; width?: number; height?: number }

/**
 * Turns inline SVG markup into standalone SVG XML (and its viewBox attribute),
 * or undefined when the markup holds no SVG element.
 */
export type SvgSerializer = (markup: string) => { xml: string; viewBox?: string | null } | undefined

/** The size a viewBox attribute gives ("minX minY width height"), if it is usable. */
export function viewBoxSize(viewBox?: string | null): { width: number; height: number } | undefined {
    const parts = (viewBox ?? '').trim().split(/[\s,]+/).map(Number)
    if (parts.length !== 4 || !parts.every(Number.isFinite)) return undefined
    const [, , width, height] = parts
    return width > 0 && height > 0 ? { width, height } : undefined
}

/** An SVG document as a data: address an `<img>` can load. */
export const svgDataUrl = (xml: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`

/**
 * The image source for the widget's `image` setting: inline SVG markup (also
 * after an XML declaration or doctype), a data: image address, bare base64, an
 * absolute URL or a relative path. Inline SVG becomes a data: address too, so
 * every background is drawn by an `<img>`. Undefined when nothing can be drawn.
 */
export function imageSource(image: unknown, serializeSvg: SvgSerializer): ImageSource | undefined {
    // json2ts types the custom `image` type as an empty interface; it holds a string.
    if (!image || typeof image !== 'string') return undefined
    const raw = image.trim()

    // Inline SVG markup (optionally starting with an XML declaration or other preamble)
    const trimmed = raw.replace(/^﻿/, '').trimStart()

    // Find the actual <svg ...>...</svg> block even if preceded by <?xml ...?> or <!DOCTYPE ...>
    const svgBlockMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/i)

    if (svgBlockMatch) {
        const svg = serializeSvg(svgBlockMatch[0].trim())
        if (!svg) return undefined
        return { src: svgDataUrl(svg.xml), ...viewBoxSize(svg.viewBox) }
    }

    // Full data URL (already encoded)
    if (/^data:image\/svg\+xml[,;]/.test(raw)) return { src: raw }
    if (/^data:image\/[a-zA-Z.+-]+;base64,/.test(raw)) return { src: raw }

    // Bare base64 string (heuristic)
    if (/^[A-Za-z0-9+/]+=*$/.test(raw) && raw.length > 100) return { src: `data:image/*;base64,${raw}` }

    // Absolute URL
    try {
        new URL(raw)
        return { src: raw }
    } catch {
        // Relative path
        if (/^([./]|\/)/.test(raw)) return { src: raw }
    }

    return undefined
}
