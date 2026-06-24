#!/usr/bin/env ruby
# frozen_string_literal: true

# Regenerates _data/events.yml from a published Google Sheet CSV.
#
# The Google Sheet is the source of truth for events. This script fetches the
# sheet (published to the web as CSV), validates the rows, and rewrites
# _data/events.yml in the exact format the events layout expects — so the site
# rendering, filters and SEO are unchanged.
#
# Usage:
#   EVENTS_SHEET_CSV_URL="https://docs.google.com/.../pub?output=csv" \
#     ruby scripts/sheet_to_events.rb
#
# Safety: if the fetch fails, the sheet is empty, or any required field is
# missing, the script exits non-zero WITHOUT touching _data/events.yml — a
# malformed sheet can never wipe the live events.
#
# Sheet columns (one row per event, headers in row 1):
#   Top level : id, active, featured, type, categories, image, image_adjust,
#               location, price, spots, time, registration_url
#   Per language (da_ / en_ prefix): badge, title, date, level, description,
#               time, price_label, spots_label, highlights, alt, registration_url
#
# Cell conventions:
#   booleans   - TRUE/FALSE (blank active -> true, blank featured -> false)
#   categories - comma- or space-separated (e.g. "upcoming, camp")
#   highlights - "|"- or newline-separated (one highlight per line)
#   blank optional cells are omitted from the YAML.

require 'csv'
require 'yaml'
require 'open-uri'
require 'fileutils'

ROOT      = File.expand_path('..', __dir__)
OUTPUT    = File.join(ROOT, '_data', 'events.yml')
IMAGE_DIR = File.join(ROOT, 'images', 'events')

# Map a downloaded image's Content-Type to a file extension.
EXT_BY_TYPE = {
  'image/jpeg'    => '.jpg',
  'image/jpg'     => '.jpg',
  'image/png'     => '.png',
  'image/webp'    => '.webp',
  'image/gif'     => '.gif',
  'image/svg+xml' => '.svg'
}.freeze

# Per-language fields, in the order they appear under da:/en: in the YAML.
LANG_FIELDS          = %w[badge title date level description time price_label spots_label highlights alt registration_url].freeze
LIST_LANG_FIELDS     = %w[highlights].freeze
REQUIRED_LANG_FIELDS = %w[badge title date description].freeze
REQUIRED_TOP_FIELDS  = %w[type image location].freeze

HEADER = <<~HDR
  # AUTO-GENERATED from Google Sheet by scripts/sheet_to_events.rb — do not edit by hand.
  # Edit events in the Google Sheet; the "Sync events" GitHub Action regenerates this file.
  # See CLAUDE.md "Events System" for the column schema and workflow.
HDR

def blank?(value)
  value.nil? || value.to_s.strip.empty?
end

def truthy?(value)
  %w[true yes 1 y x].include?(value.to_s.strip.downcase)
end

def slugify(str)
  str.to_s.strip.downcase
     .gsub(/[^a-z0-9\s-]/, '')
     .gsub(/\s+/, '-')
     .gsub(/-+/, '-')
     .gsub(/\A-|-\z/, '')
end

# Extract a Google Drive file id from any of the URL shapes the Form/sheet
# produces, e.g. open?id=, uc?id=, /file/d/<id>/view, /d/<id>. Returns nil for
# non-Drive URLs (plain https:// images and /images/... paths pass through).
def drive_file_id(url)
  return nil unless url =~ /(?:drive|docs)\.google\.com/

  return Regexp.last_match(1) if url =~ %r{/file/d/([\w-]+)}
  return Regexp.last_match(1) if url =~ /[?&]id=([\w-]+)/
  return Regexp.last_match(1) if url =~ %r{/d/([\w-]+)}

  nil
end

# Turn a Drive image URL into a self-hosted /images/events/<id>.<ext> path,
# downloading the file once. Idempotent: if the file is already present it is
# reused (no re-download, no commit churn). Non-Drive URLs/paths pass through
# unchanged. On download failure it falls back to a best-effort direct Drive
# link (with a warning) so the build never breaks over one image.
def localize_image(url)
  return url if blank?(url)

  url = url.split(',').first.strip # a multi-file upload yields comma-separated URLs
  id  = drive_file_id(url)
  return url unless id

  existing = Dir.glob(File.join(IMAGE_DIR, "#{id}.*")).first
  return "/images/events/#{File.basename(existing)}" if existing

  FileUtils.mkdir_p(IMAGE_DIR)
  content_type = nil
  data = URI.parse("https://drive.google.com/uc?export=download&id=#{id}").open do |io|
    content_type = io.content_type
    io.read
  end

  if content_type.nil? || content_type.start_with?('text/html')
    warn "WARNING: could not download Drive image #{id} (got #{content_type.inspect}); using direct link fallback."
    return "https://lh3.googleusercontent.com/d/#{id}"
  end

  ext  = EXT_BY_TYPE[content_type] || '.jpg'
  path = File.join(IMAGE_DIR, "#{id}#{ext}")
  File.binwrite(path, data)
  puts "Downloaded Drive image #{id} -> /images/events/#{id}#{ext}"
  "/images/events/#{id}#{ext}"
rescue StandardError => e
  warn "WARNING: failed to download Drive image (#{e.class}: #{e.message}); using direct link fallback."
  id ? "https://lh3.googleusercontent.com/d/#{id}" : url
end

url = ENV['EVENTS_SHEET_CSV_URL']
abort 'ERROR: EVENTS_SHEET_CSV_URL is not set.' if blank?(url)

csv_text =
  begin
    if url =~ %r{\Ahttps?://}i
      URI.parse(url).open(&:read)
    else
      # Local path (or file:// URL) — handy for testing.
      File.read(url.sub(%r{\Afile://}i, ''))
    end
  rescue StandardError => e
    abort "ERROR: failed to fetch sheet CSV (#{e.class}: #{e.message}) — _data/events.yml left unchanged."
  end

# Treat the sheet as UTF-8 and drop a leading byte-order mark so the first
# header (and Danish characters like å/æ/ø) are read correctly.
csv_text = csv_text.dup.force_encoding('UTF-8').sub(/\A\uFEFF/, '')

rows = CSV.parse(csv_text, headers: true)
if rows.headers.nil? || rows.headers.compact.empty?
  abort 'ERROR: sheet CSV has no header row — _data/events.yml left unchanged.'
end

errors = []
events = []

rows.each_with_index do |row, idx|
  line = idx + 2 # +1 for the header row, +1 for 1-based counting
  h = row.to_h.transform_keys { |k| k.to_s.strip } # tolerate stray spaces in headers
  next if h.values.all? { |v| blank?(v) } # skip fully blank rows

  ev = {}
  ev['id']       = blank?(h['id']) ? slugify(h['en_title'] || h['da_title']) : h['id'].strip
  ev['active']   = blank?(h['active'])   ? true  : truthy?(h['active'])
  ev['featured'] = blank?(h['featured']) ? false : truthy?(h['featured'])
  ev['type']     = h['type'].strip          unless blank?(h['type'])
  unless blank?(h['categories'])
    ev['categories'] = h['categories'].split(/[,\s]+/).map(&:strip).reject(&:empty?)
  end
  ev['image']            = h['image'].strip            unless blank?(h['image'])
  ev['image-adjust']     = h['image_adjust'].strip     unless blank?(h['image_adjust'])
  ev['location']         = h['location'].strip         unless blank?(h['location'])
  ev['price']            = h['price'].strip            unless blank?(h['price'])
  ev['spots']            = h['spots'].to_i             unless blank?(h['spots'])
  ev['time']             = h['time'].strip             unless blank?(h['time'])
  ev['registration_url'] = h['registration_url'].strip unless blank?(h['registration_url'])

  %w[da en].each do |lang|
    lh = {}
    LANG_FIELDS.each do |field|
      value = h["#{lang}_#{field}"]
      next if blank?(value)

      if LIST_LANG_FIELDS.include?(field)
        # "|"- or newline-separated (a Form paragraph yields one item per line).
        items = value.split(/\||\r?\n/).map(&:strip).reject(&:empty?)
        lh[field] = items unless items.empty?
      else
        lh[field] = value.strip
      end
    end
    ev[lang] = lh
  end

  REQUIRED_TOP_FIELDS.each do |field|
    errors << "Row #{line} (#{ev['id']}): missing required field '#{field}'" if blank?(ev[field])
  end
  %w[da en].each do |lang|
    REQUIRED_LANG_FIELDS.each do |field|
      errors << "Row #{line} (#{ev['id']}): missing required field '#{lang}_#{field}'" if blank?(ev[lang][field])
    end
  end

  events << ev
end

if events.empty?
  abort 'ERROR: no events parsed from sheet — _data/events.yml left unchanged.'
end

unless errors.empty?
  warn 'ERROR: validation failed — _data/events.yml left unchanged:'
  errors.each { |e| warn "  - #{e}" }
  exit 1
end

# Sheet is valid — now self-host any Drive-uploaded images (downloads happen
# only after validation passes, so a bad sheet never fetches anything).
events.each { |ev| ev['image'] = localize_image(ev['image']) }

body = YAML.dump(events, line_width: -1).sub(/\A---\n/, '')
File.write(OUTPUT, HEADER + "\n" + body)
puts "Wrote #{events.length} events to #{OUTPUT}"
