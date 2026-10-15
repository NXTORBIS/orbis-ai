import { sharpenedImage } from '../lib/upscale'

const SHARPEN_IMAGES = false
import { memo, useEffect, useMemo, useState } from 'react'
import type { ResearchSource } from '../../../shared/types'
import { linkCitations } from '../../../shared/research'
import { openInOrbisBrowser } from '../lib/openInBrowser'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components, ExtraProps, Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { copyText, hastText, normalizeMath } from '../lib/utils'
import { rehypeCallouts } from '../../../shared/chatCallout'
import { tableChart } from '../../../shared/chatTableChart'
import { plotToSvg } from '../../../shared/artifacts/svg'
import { Download, Pencil } from 'lucide-react'
import { useImageEditor } from '../lib/imageEditor'
import { CheckIcon, CopyIcon } from './Icons'
import ImageLightbox from './ImageLightbox'

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath]
// Auto-detection is skipped: it's slow on streaming text and often wrong for short snippets.
const rehypePlugins: Options['rehypePlugins'] = [rehypeCallouts, rehypeKatex, [rehypeHighlight, { detect: false }]]

interface HastLike {
  type: string
  tagName?: string
  value?: string
  children?: HastLike[]
}

/** The header cells and body rows of a table's syntax tree, as the text shown in them. */
function tableCells(node: HastLike | undefined): { header: string[]; rows: string[][] } | null {
  if (!node) return null
  const find = (n: HastLike, tag: string, out: HastLike[] = []): HastLike[] => {
    if (n.type === 'element' && n.tagName === tag) out.push(n)
    for (const c of n.children ?? []) find(c, tag, out)
    return out
  }
  const cellsOf = (tr: HastLike): string[] => (tr.children ?? []).filter((c) => c.type === 'element' && (c.tagName === 'th' || c.tagName === 'td')).map((c) => hastText(c).trim())
  const head = find(node, 'thead')[0]
  const body = find(node, 'tbody')[0]
  const headRow = head ? find(head, 'tr')[0] : undefined
  if (!headRow || !body) return null
  return { header: cellsOf(headRow), rows: find(body, 'tr').map(cellsOf) }
}

/**
 * The chart under a table of numbers. It appears by itself (that is the point), can be hidden, and says what it
 * left out. The drawing is the plot engine's, shown as an image so nothing from a reply is ever put into the page
 * as markup.
 */
function TableChart({ header, rows }: { header: string[]; rows: string[][] }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const drawn = useMemo(() => {
    const c = tableChart(header, rows)
    if (!c) return null
    const { svg } = plotToSvg({ ...c.plot, title: '' }, { width: 760, height: 320 })
    return { c, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }
  }, [header, rows])
  if (!drawn) return null
  return (
    <figure className="table-chart">
      <figcaption>
        <span>{drawn.c.title}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide chart' : 'Show chart'}
        </button>
      </figcaption>
      {open && (
        <>
          <img src={drawn.src} alt={`${drawn.c.kind === 'bar' ? 'Bar' : 'Line'} chart: ${drawn.c.title}`} />
          <p>Drawn from the table above{drawn.c.notes.length ? `. ${drawn.c.notes.join(' ')}` : '.'}</p>
        </>
      )}
    </figure>
  )
}

function CodeBlock({ node, children, ...rest }: React.ComponentProps<'pre'> & ExtraProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const first = node?.children[0]
  const className = first?.type === 'element' ? first.properties.className : undefined
  const language = Array.isArray(className)
    ? className
        .map(String)
        .find((c) => c.startsWith('language-'))
        ?.slice('language-'.length)
    : undefined

  const copy = (): void => {
    void copyText(hastText(node)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Kept in Create as a file in this language: versions, the right extension when saved, never run.
  const [kept, setKept] = useState<{ ok: boolean; says: string } | null>(null)
  const keep = (): void => {
    if (!language) return
    void window.api.creationRun({ operation: 'artifact.create', kind: 'code', language, title: `${language} from a chat`, text: hastText(node).replace(/\n$/, '') + '\n', source: 'a chat reply' }).then((result) => {
      setKept(result.ok ? { ok: true, says: 'Kept in Create' } : { ok: false, says: result.message })
      setTimeout(() => setKept(null), result.ok ? 2500 : 8000)
    })
  }

  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language ?? 'code'}</span>
        <span className="code-actions">
          {language && (
            <button className="code-copy" onClick={keep} title={kept && !kept.ok ? kept.says : 'Keep this in Create as a file: versions, and the right extension when saved. Orbis never runs it.'}>
              {kept?.ok ? <CheckIcon size={14} /> : null}
              {kept ? (kept.ok ? kept.says : 'Not kept') : 'Keep'}
            </button>
          )}
          <button className="code-copy" onClick={copy}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  )
}

function Image({ node: _node, src, alt, title, ...props }: React.ComponentProps<'img'> & ExtraProps): React.JSX.Element {
  const openEditor = useImageEditor()
  const [saved, setSaved] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [sharp, setSharp] = useState<{ from: string; url: string } | null>(null)
  const [sharpening, setSharpening] = useState(false)
  // Generated images arrive small and soft; they are redrawn sharper on this computer, and swapped in once ready.
  // Switched off: in the real app sharpening appeared to stall the window, and that has not been found yet.
  useEffect(() => {
    if (!SHARPEN_IMAGES || typeof src !== 'string' || !src.startsWith('data:image/')) return undefined
    let live = true
    setSharpening(true)
    void sharpenedImage(src)
      .then((url) => live && url !== src && setSharp({ from: src, url }))
      .catch((err: unknown) => console.warn('[images] could not sharpen', err))
      .finally(() => live && setSharpening(false))
    return () => {
      live = false
    }
  }, [src])
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return <img src={src} alt={alt} title={title} {...props} className="markdown-inline-image" />
  const shown = sharp?.from === src ? sharp.url : src
  const seedMatch = /^seed:(\d+)$/.exec(title ?? '')

  const download = (): void => {
    void window.api.saveImage(shown, alt || 'orbis-image').then((ok) => {
      if (!ok) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }
  const edit = openEditor
    ? (): void => openEditor({ src, prompt: alt ?? '', seed: seedMatch ? Number(seedMatch[1]) : undefined, alpha: src.startsWith('data:image/png') })
    : undefined

  return (
    <figure className="generated-image">
      <button type="button" className="generated-image-open" title="Open full preview" onClick={() => setPreviewing(true)}>
        <img src={shown} alt={alt} {...props} />
        {sharpening && !sharp && <span className="image-sharpening">Sharpening…</span>}
      </button>
      <figcaption>
        <span className="truncate" title={alt}>{alt}</span>
        {edit && (
          <button type="button" className="image-download image-edit" title="Edit image" onClick={edit}>
            <Pencil size={14} />
            Edit
          </button>
        )}
        <button type="button" className="image-download" onClick={download} title="Download image">
          {saved ? <CheckIcon size={14} /> : <Download size={14} />}
          {saved ? 'Saved' : 'Download'}
        </button>
      </figcaption>
      {previewing && (
        <ImageLightbox
          src={shown}
          alt={alt ?? ''}
          saved={saved}
          onClose={() => setPreviewing(false)}
          onDownload={download}
          onEdit={
            edit &&
            (() => {
              setPreviewing(false)
              edit()
            })
          }
        />
      )}
    </figure>
  )
}

const SOURCE_LINK = '#orbis-source-'

/** Links open in the Orbis browser; a citation like [2] becomes a chip that opens that source's exact page. */
function makeLink(sources: ResearchSource[] | undefined): Components['a'] {
  return function Link({ node: _node, href, children, ...props }) {
    if (href?.startsWith(SOURCE_LINK)) {
      const source = sources?.find((s) => s.n === Number(href.slice(SOURCE_LINK.length)))
      if (!source) return <>{children}</>
      return (
        <button type="button" className="source-cite" title={`${source.title} — ${source.publisher ?? source.domain}. Open in Orbis browser`} onClick={() => openInOrbisBrowser(source.url)}>
          {source.n}
        </button>
      )
    }
    if (href && /^https?:\/\//i.test(href)) {
      return (
        <a
          {...props}
          href={href}
          title={props.title ?? `Open in Orbis browser: ${href}`}
          onClick={(e) => {
            e.preventDefault()
            openInOrbisBrowser(href)
          }}
        >
          {children}
        </a>
      )
    }
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
}

const components: Components = {
  pre: CodeBlock,
  img: Image,
  a: makeLink(undefined),
  // A model that writes a line break inside a table cell often wraps it in backticks (`<br>`), because a table row
  // cannot hold a newline. Shown literally that is noise in the middle of the cell, so an inline code span whose
  // whole content is a break tag is drawn as the break it meant. Fenced code is untouched (it has a language class
  // and sits inside <pre>).
  code: ({ node: _node, className, children, ...props }) => {
    const only = Array.isArray(children) ? children.join('') : typeof children === 'string' ? children : ''
    if (!className && /^<br\s*\/?>$/i.test(only.trim())) return <br />
    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
  table: ({ node, ...props }) => {
    const cells = tableCells(node as HastLike | undefined)
    return (
      <>
        <div className="table-wrap">
          <table {...props} />
        </div>
        {cells && <TableChart header={cells.header} rows={cells.rows} />}
      </>
    )
  }
}

// The default transform blanks data: URLs, which is how generated images arrive.
const urlTransform = (url: string): string => (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ? url : defaultUrlTransform(url))

function Markdown({ text, sources }: { text: string; sources?: ResearchSource[] }): React.JSX.Element {
  const content = useMemo(() => (sources?.length ? linkCitations(normalizeMath(text), sources) : normalizeMath(text)), [text, sources])
  const withSources = useMemo(() => (sources?.length ? { ...components, a: makeLink(sources) } : components), [sources])
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={withSources} urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
