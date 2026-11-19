import { html, css, LitElement, nothing } from 'lit'
import { property, query, state } from 'lit/decorators.js'
import { styleMap } from 'lit/directives/style-map.js'
import { ImageOverlayConfiguration, Overlays } from './definition-schema.js'
import { ImageSource, SvgSerializer, imageSource } from './image-source.js'
import { repeat } from 'lit/directives/repeat.js'
import './linear-progress.js'

// Views over the generated schema types. json-schema-to-typescript names the
// layer array `Overlays` and gives its pin arrays no names of their own, so the
// per-layer and per-pin types the component works with are derived here.
type Overlay = Overlays[number]
type TextOverlay = Overlay
type ProgressOverlay = Overlay
type TextItem = NonNullable<Overlay['textPins']>[number]
type ProgressItem = NonNullable<Overlay['progressPins']>[number]

// Not schema data: the scaling factor and letterbox offsets of the background
// image inside the widget, recomputed by getModifier() on every resize.
type Modifier = {
    scaler: number
    xOffset: number
    yOffset: number
    visibleWidth: number
    visibleHeight: number
}

type Theme = {
    theme_name: string
    theme_object: any
}

// Decimals for toFixed(), which throws above 100.
const fractionDigits = (precision: number): number => Math.min(100, Math.floor(precision))

// The list a config holds, without null slots; anything but a list reads as none.
const objects = <T>(list: unknown): T[] =>
    Array.isArray(list) ? list.filter((item) => !!item && typeof item === 'object') : []

// Inline SVG markup is drawn as an image, never inserted into the widget's DOM.
// It is parsed in a document of its own that DOMParser creates without scripting
// or loading, so markup the HTML parser accepts (no xmlns, unquoted attributes)
// becomes well-formed SVG XML for the <img>. Drawn in place, its text inherited
// the widget's sans-serif font; an image inherits nothing, so the root gets that
// font as its default (any font the SVG sets itself still wins).
const serializeSvg: SvgSerializer = (markup) => {
    const svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')
    if (!svg) return undefined
    if (!svg.hasAttribute('font-family')) svg.setAttribute('font-family', 'sans-serif')
    return { xml: new XMLSerializer().serializeToString(svg), viewBox: svg.getAttribute('viewBox') }
}

export class WidgetOverlay extends LitElement {
    @property({ type: Object })
    inputData?: ImageOverlayConfiguration

    @property({ type: Object })
    theme?: Theme

    @state() private themeTitleColor?: string
    @state() private themeSubtitleColor?: string
    @state() private image?: ImageSource

    @state() private modifier?: Modifier

    private resizeObserver: ResizeObserver

    constructor() {
        super()
        this.getModifier = this.getModifier.bind(this)
        this.resizeObserver = new ResizeObserver(this.getModifier)
    }

    @query('#base-layer')
    private baseLayer!: any

    version: string = 'versionplaceholder'

    connectedCallback() {
        super.connectedCallback()
        // Observed on every attach and released on detach: Studio moves a tile by
        // detaching and re-attaching it, and removes it for good the same way.
        this.resizeObserver.observe(this)
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        this.resizeObserver.disconnect()
    }

    update(changedProperties: Map<string, any>) {
        if (changedProperties.has('inputData')) {
            this.transform()
            if (!this.modifier) this.getModifier()
        }
        if (changedProperties.has('theme') || !this.hasUpdated) {
            this.registerTheme(this.theme)
        }
        super.update(changedProperties)
    }

    registerTheme(theme?: Theme) {
        // No background: Studio's tile already paints --re-tile-background-color,
        // and painting it again doubled a translucent tile colour.
        this.themeTitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`
        this.themeSubtitleColor = `var(--re-text-color, ${this.theme?.theme_object?.title?.subtextStyle?.color || this.theme?.theme_object?.title?.textStyle?.color || 'inherit'})`
    }

    transform() {
        this.image = imageSource(this.inputData?.image, serializeSvg)
    }

    private async getModifier() {
        if (!this.baseLayer) return
        const rect = this.baseLayer.getBoundingClientRect()
        if (!rect) return

        const containerRect = this.baseLayer.parentElement?.getBoundingClientRect()
        if (!containerRect) return

        // Inline SVG is scaled against its viewBox, as when it was drawn in place;
        // every other image against its natural size.
        const intrinsicWidth: number | undefined = this.image?.width ?? this.baseLayer.naturalWidth
        const intrinsicHeight: number | undefined = this.image?.height ?? this.baseLayer.naturalHeight

        if (!intrinsicWidth || !intrinsicHeight) return

        // Actual visible area of the image/svg
        const scaleX = rect.width / intrinsicWidth
        const scaleY = rect.height / intrinsicHeight
        const scale = Math.min(scaleX, scaleY)

        const visibleWidth = intrinsicWidth * scale
        const visibleHeight = intrinsicHeight * scale

        const xOffset = (containerRect.width - visibleWidth) / 2
        const yOffset = (containerRect.height - visibleHeight) / 2

        this.modifier = { scaler: scale, xOffset, yOffset, visibleWidth, visibleHeight }
    }

    // Undefined for a pin without a usable position, which is then not drawn.
    private getOverlayItemPosition(relX: unknown, relY: unknown, modifier: Modifier) {
        const x = Number(relX)
        const y = Number(relY)
        if (relX === undefined || relY === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return
        return {
            left: x * modifier.visibleWidth,
            top: y * modifier.visibleHeight
        }
    }

    /**
     * The colour of the section a value falls in: sectionLimits are ascending
     * thresholds, and colors[i - 1] applies up to limit i. Undefined below the first
     * limit, above the last, and when the layer has no (or broken) sections.
     */
    private sectionColor(overlay: Overlay, value: number): string | undefined {
        const sections: any = overlay.sections
        const limits: unknown[] = Array.isArray(sections?.sectionLimits) ? sections.sectionLimits : []
        const colors: unknown[] = Array.isArray(sections?.colors) ? sections.colors : []
        const index = limits.findIndex((limit) => value <= Number(limit))
        const color = index >= 1 ? colors[index - 1] : undefined
        return typeof color === 'string' && color ? color : undefined
    }

    renderText(_overlay: Overlay, item: TextItem, modifier: Modifier) {
        const overlay = _overlay as TextOverlay
        const pos = this.getOverlayItemPosition(item.relXPos, item.relYPos, modifier)
        if (!pos) return nothing

        const precision = overlay.textStyle?.precision ?? 1
        let value = item.data
        const numericValue = Number(value)
        let color = '#333'
        if (!Number.isNaN(numericValue)) {
            if (typeof precision === 'number' && precision >= 0) {
                value = numericValue.toFixed(fractionDigits(precision))
                color = this.sectionColor(overlay, numericValue) ?? '#333'
            }
        }

        const styles = {
            'font-size': (overlay.textStyle?.fontSize ?? 14) * modifier.scaler + 'px',
            color,
            // json2ts types colours as empty interfaces; they hold CSS colour strings.
            'background-color': overlay.textStyle?.backgroundColor as string | undefined,
            'font-weight': overlay.textStyle?.fontWeight,
            left: `${pos.left}px`,
            top: `${pos.top}px`,
            'border-radius': 10 * modifier.scaler + 'px',
            'transform-origin': '50% 50%',
            transform: `translate(-50%, -50%)`,
            padding: `${6 * modifier.scaler}px ${12 * modifier.scaler}px`
        }

        return html`
            <div class="overlay-item" style=${styleMap(styles)}>${item.prefix}${value}${item.suffix}</div>
        `
    }

    renderProgress(_overlay: Overlay, item: ProgressItem, modifier: Modifier) {
        const overlay = _overlay as ProgressOverlay
        const pos = this.getOverlayItemPosition(item.relXPos, item.relYPos, modifier)
        if (!pos) return nothing

        const sectionColor = this.sectionColor(overlay, Number(item.data))
        const styles = {
            '--progress-color': sectionColor ?? '#333',
            '--progress-width': (overlay.progressStyle?.width ?? 10) * modifier.scaler + 'px',
            '--progress-height': (overlay.progressStyle?.height ?? 100) * modifier.scaler + 'px',
            '--progress-background': (overlay.progressStyle?.backgroundColor as string | undefined) ?? '#fff',
            'border-radius': 10 * modifier.scaler + 'px',
            'transform-origin': '50% 50%',
            transform: `translate(-50%, -50%) rotate(${overlay.progressStyle?.rotate ?? 0}deg)`,
            left: `${pos.left}px`,
            top: `${pos.top}px`
        }
        // The bar fills from the lowest to the highest section limit. Without two
        // different limits there is no range, and the bar stays empty (a layer
        // without sections used to throw here and blank the whole tile).
        const rawValue = Number(item.data)
        const sections: any = overlay.sections
        const limits: number[] = (Array.isArray(sections?.sectionLimits) ? sections.sectionLimits : [])
            .map(Number)
            .filter(Number.isFinite)
        const min = Math.min(...limits)
        const max = Math.max(...limits)
        const fraction = limits.length && max !== min ? (rawValue - min) / (max - min) : 0
        const percent = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
        return html`
            <widget-overlay-progress-versionplaceholder
                .value=${percent}
                style=${styleMap(styles)}
            ></widget-overlay-progress-versionplaceholder>
        `
    }

    renderLayer(overlay: Overlay) {
        const modifier = this.modifier
        if (!modifier) return nothing
        const containerStyles = {
            left: modifier.xOffset + 'px',
            top: modifier.yOffset + 'px',
            width: modifier.visibleWidth + 'px',
            height: modifier.visibleHeight + 'px'
        }
        return html`<div
            class="overlay"
            style=${styleMap(containerStyles)}
            type="${overlay.layerType}"
            name="${overlay.layerName}"
        >
            ${overlay.layerType === 'text'
                ? this.renderTextLayer(overlay as TextOverlay)
                : this.renderProgressLayer(overlay as ProgressOverlay)}
        </div>`
    }

    renderTextLayer(overlay: TextOverlay) {
        const modifier = this.modifier
        if (!modifier) return nothing
        return html`${repeat(
            objects<TextItem>(overlay.textPins),
            (item, idx) => idx,
            (item) => html`${this.renderText(overlay, item, modifier)}`
        )}`
    }

    renderProgressLayer(overlay: ProgressOverlay) {
        const modifier = this.modifier
        if (!modifier) return nothing
        return html`${repeat(
            objects<ProgressItem>(overlay.progressPins),
            (item, idx) => idx,
            (item) => html`${this.renderProgress(overlay, item, modifier)}`
        )}`
    }

    static styles = css`
        :host {
            display: block;
            font-family: sans-serif;
            box-sizing: border-box;
            margin: auto;
            container-type: size;
        }

        .paging:not([active]) {
            display: none !important;
        }

        .wrapper {
            display: flex;
            flex-direction: column;
            height: 100%;
            width: 100%;
            padding: 2cqh 2cqw;
            box-sizing: border-box;
        }

        h3 {
            margin: 0;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        p {
            margin: 10px 0 0 0;
            max-width: 300px;
            font-size: 14px;
            line-height: 17px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .img-container {
            flex: 1;
            box-sizing: border-box;
            overflow: hidden;
            position: relative;
        }

        img {
            width: 100%; /* Set the width of the container */
            height: 100%;
        }
        .no-data {
            font-size: 20px;
            display: flex;
            height: 100%;
            width: 100%;
            text-align: center;
            align-items: center;
            justify-content: center;
        }

        .overlay {
            position: absolute;
            pointer-events: none;
        }

        .overlay-item {
            position: absolute;
            pointer-events: auto;
        }
    `

    render() {
        const hasImage = !!this.image
        return html`
            <div class="wrapper">
                <h3 class="paging" ?active=${this.inputData?.title} style="color: ${this.themeTitleColor}">
                    ${this.inputData?.title}
                </h3>
                <p
                    class="paging"
                    ?active=${this.inputData?.subTitle}
                    style="color: ${this.themeSubtitleColor}"
                >
                    ${this.inputData?.subTitle}
                </p>

                <div class="paging no-data" ?active=${!hasImage}>No Image</div>
                <div class="img-container paging" ?active="${hasImage}">
                    ${this.image
                        ? html`<img
                              id="base-layer"
                              @load="${this.getModifier}"
                              src="${this.image.src}"
                              alt="Image Widget"
                              style="object-fit: ${this.inputData?.stretchToFit ? 'fill' : 'contain'}"
                          />`
                        : ''}
                    ${repeat(
                        objects<Overlay>(this.inputData?.overlays),
                        // Unique even when layers share a name or have none: duplicate
                        // repeat() keys corrupt Lit's DOM bookkeeping.
                        (o, index) => `${index}:${o.layerName ?? ''}`,
                        (o) => html` ${this.renderLayer(o)} `
                    )}
                </div>
            </div>
        `
    }
}
window.customElements.define('widget-overlay-versionplaceholder', WidgetOverlay)
