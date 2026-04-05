import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_STORAGE_BUCKET || 'resident-uploads'

export const supabaseReady = Boolean(
  SUPABASE_URL && SUPABASE_URL !== 'your_supabase_project_url' &&
  SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'your_supabase_anon_key'
)

export const supabase = supabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null

function sanitizeFilename(filename) {
  return String(filename || 'upload')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function uploadResidentPhoto({ file, residentId }) {
  if (!supabase) {
    throw new Error('Supabase is not configured for photo uploads.')
  }

  if (!file) return null

  const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
  const baseName = sanitizeFilename(file.name.replace(/\.[^.]+$/, '')) || 'issue-photo'
  const objectPath = `resident-portal/${residentId}/${Date.now()}-${baseName}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    })

  if (uploadError) {
    throw new Error('Photo upload failed. Make sure the Supabase storage bucket exists and is public.')
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath)

  if (!data?.publicUrl) {
    throw new Error('Photo uploaded, but no public URL was returned.')
  }

  return {
    url: data.publicUrl,
    filename: file.name,
  }
}
