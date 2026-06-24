#!/usr/bin/env ruby
# frozen_string_literal: true

# One-time bootstrap: dumps the current _data/events.yml to a CSV whose columns
# match what scripts/sheet_to_events.rb expects. Import the output into a new
# Google Sheet so no existing events (including active: false examples) are lost.
#
# Usage:
#   ruby scripts/events_to_csv.rb > events.csv
#
# Then in Google Sheets: File -> Import -> Upload -> events.csv.

require 'yaml'
require 'csv'

ROOT = File.expand_path('..', __dir__)

TOP_COLS    = %w[id active featured type categories image image_adjust location price spots time registration_url].freeze
LANG_FIELDS = %w[badge title date level description time price_label spots_label highlights alt registration_url].freeze
HEADERS     = TOP_COLS + %w[da en].flat_map { |lang| LANG_FIELDS.map { |f| "#{lang}_#{f}" } }

def bool(value)
  return '' if value.nil?

  value ? 'TRUE' : 'FALSE'
end

events = YAML.load_file(File.join(ROOT, '_data', 'events.yml')) || []

output = CSV.generate do |csv|
  csv << HEADERS

  events.each do |ev|
    row = {
      'id'               => ev['id'],
      'active'           => bool(ev['active']),
      'featured'         => bool(ev['featured']),
      'type'             => ev['type'],
      'categories'       => Array(ev['categories']).join(', '),
      'image'            => ev['image'],
      'image_adjust'     => ev['image-adjust'],
      'location'         => ev['location'],
      'price'            => ev['price'],
      'spots'            => ev['spots'],
      'time'             => ev['time'],
      'registration_url' => ev['registration_url']
    }

    %w[da en].each do |lang|
      lh = ev[lang] || {}
      LANG_FIELDS.each do |field|
        value = lh[field]
        value = Array(value).join(' | ') if field == 'highlights'
        row["#{lang}_#{field}"] = value
      end
    end

    csv << HEADERS.map { |h| row[h] }
  end
end

# Write raw UTF-8 bytes with a leading BOM so Excel/Sheets/Windows tools read
# Danish characters (å/æ/ø) correctly instead of mojibake.
$stdout.binmode
$stdout.write("\uFEFF".encode('UTF-8'))
$stdout.write(output.encode('UTF-8'))
