import { Seo } from '../lib/seo'

export default function Apply() {
  return (
    <div className="bg-cream-50 min-h-screen">
      <Seo
        title="Apply | Axis Seattle Housing"
        description="Submit an application for Axis Seattle shared housing near the University of Washington."
        pathname="/apply"
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Apply</h1>
        <p className="mt-2 text-sm text-slate-500">Fill out the form below and we'll get back to you within 2 business days.</p>
        <div className="mt-8">
          <iframe
            className="airtable-embed"
            src="https://airtable.com/embed/appNBX2inqfJMyqYV/pagHuYqWpjJGDt9Oz/form"
            width="100%"
            height="700"
            style={{ background: 'transparent', border: '1px solid #ccc', borderRadius: '16px' }}
          />
        </div>
      </div>
    </div>
  )
}
