require 'csv'
require 'yaml'
require 'open-uri'
require 'fileutils'
require 'json'

class ClubSheets
  LANGUAGES = %w[da en].freeze
  CLUB_FIELDS = %w[club-name description intro interests mailerlite-form].freeze
  LOCATION_FIELDS = %w[address address-link phone email club-contact contact-name-id contact-email-id contact-interest-id contact-content-id].freeze
  SECTIONS = {
    'instructors' => ['instructors', %w[name start image descriptions]],
    'schedules' => ['classes', %w[title days times]],
    'class_types' => ['classtypes', %w[name descriptions perfect-for]],
    'pricing' => ['pricing', %w[name price suffix detail descriptions featured cta cta_link]],
    'faqs' => ['faq', %w[q a]]
  }.freeze
  SHARED_FIELDS = {
    'clubs' => %w[club-name],
    'instructors' => %w[name start image],
    'schedules' => %w[times],
    'pricing' => %w[price featured cta_link]
  }.freeze
  TABS = (%w[clubs locations] + SECTIONS.keys).freeze

  def initialize(root)
    @root = root
  end

  def blank?(value)
    value.nil? || value.to_s.strip.empty?
  end

  def column(field)
    field.tr('-', '_')
  end

  def language_headers(fields)
    LANGUAGES.flat_map { |language| fields.map { |field| "#{language}_#{column(field)}" } }
  end

  def headers(tab)
    return LOCATION_FIELDS.map { |field| column(field) } if tab == 'locations'

    shared = SHARED_FIELDS.fetch(tab, [])
    fields = tab == 'clubs' ? CLUB_FIELDS : SECTIONS.fetch(tab).last
    leading = tab == 'clubs' ? ['club_id'] : ['present']
    leading + shared.map { |field| column(field) } + language_headers(fields - shared)
  end

  def shared_field?(tab, field)
    field == 'present' || SHARED_FIELDS.fetch(tab, []).include?(field)
  end

  def field_value(row, tab, field, language)
    return row["#{language}_#{column(field)}"] unless shared_field?(tab, field)
    header = column(field)
    return row[header] if row.key?(header)

    values = LANGUAGES.map { |lang| row["#{lang}_#{header}"] }
    normalized = values.map { |value| value.to_s.strip }
    normalized.map!(&:upcase) if %w[present featured].include?(field)
    raise "#{tab} row #{row['__row_number']}: #{header} differs between languages; use one shared #{header} column" unless normalized.uniq.length == 1
    values.first
  end

  def item_value(item, field)
    return item.fetch('descriptions').map { |slot| slot['description'] } if field == 'days'
    return item.fetch('descriptions').map { |slot| slot['time'] } if field == 'times'

    item[field]
  end

  def shared_cell(values, label)
    cells = values.map { |value| cell(value) }
    raise "#{label} differs between languages; reconcile it before exporting" unless cells.uniq.length == 1
    cells.first
  end

  def pages
    result = {}
    LANGUAGES.each do |language|
      Dir.glob(File.join(@root, language, '*.html')).sort.each do |path|
        text = File.read(path, encoding: 'UTF-8')
        match = text.match(/\A---\r?\n(.*?)^---[^\S\r\n]*\r?\n(.*)\z/m)
        next unless match

        data = YAML.safe_load(match[1])
        next unless data.is_a?(Hash) && data['layout'] == 'club'

        club_id = File.basename(path, '.html')
        result[club_id] ||= {}
        result[club_id][language] = { path: path, data: data, body: match[2] }
      end
    end
    raise 'No club pages found' if result.empty?
    result.each { |club_id, versions| raise "Missing translation for #{club_id}" unless versions.keys.sort == LANGUAGES.sort }
    result
  end

  def locations
    YAML.safe_load_file(File.join(@root, '_data', 'locations.yml'))
  end

  def cell(value)
    return value.join("\n") if value.is_a?(Array)
    return value ? 'TRUE' : 'FALSE' if value == true || value == false

    value
  end

  def export(directory)
    records = pages
    sources = {}
    workbooks = {}
    records.each do |club_id, versions|
      tables = TABS.to_h { |tab| [tab, []] }
      contacts = versions.values.map { |version| contact_data(version[:data]) }
      raise "Contact details differ between translations for #{club_id}" unless contacts.uniq.length == 1
      tables['locations'] << LOCATION_FIELDS.to_h { |field| [column(field), contacts.first[field]] }
      row = { 'club_id' => club_id }
      SHARED_FIELDS.fetch('clubs').each do |field|
        row[column(field)] = shared_cell(versions.values.map { |version| version[:data][field] }, "#{club_id} #{field}")
      end
      LANGUAGES.each do |language|
        (CLUB_FIELDS - SHARED_FIELDS.fetch('clubs')).each { |field| row["#{language}_#{column(field)}"] = cell(versions[language][:data][field]) }
      end
      tables['clubs'] << row
      SECTIONS.each do |tab, (key, fields)|
        count = versions.values.map { |version| Array(version[:data][key]).length }.max
        count.times do |index|
          items = LANGUAGES.map { |language| Array(versions[language][:data][key])[index] }
          raise "#{club_id}/#{tab} row #{index + 2} must exist in both languages" if items.any?(&:nil?)
          item_row = { 'present' => 'TRUE' }
          shared = SHARED_FIELDS.fetch(tab, [])
          shared.each do |field|
            item_row[column(field)] = shared_cell(items.map { |item| item_value(item, field) }, "#{club_id}/#{tab} row #{index + 2} #{field}")
          end
          LANGUAGES.each do |language|
            item = Array(versions[language][:data][key])[index]
            (fields - shared).each do |field|
              item_row["#{language}_#{column(field)}"] = cell(item_value(item, field))
            end
          end
          tables[tab] << item_row
        end
      end
      club_directory = File.join(directory, club_id)
      workbooks[club_directory] = tables
      sources[club_id] = TABS.to_h { |tab| [tab, File.join(club_id, "#{tab}.csv")] }
    end
    workbooks.each { |club_directory, tables| write_tables(club_directory, tables) }
    File.write(File.join(directory, 'sources.json'), JSON.pretty_generate(sources) + "\n", encoding: 'UTF-8')
  end

  def contact_data(data)
    data['contact'] || locations.fetch(data.fetch('location'))
  end

  def write_tables(directory, tables)
    FileUtils.mkdir_p(directory)
    tables.each do |tab, rows|
      csv = CSV.generate do |output|
        output << headers(tab)
        rows.each { |row| output << headers(tab).map { |header| row[header] } }
      end
      File.write(File.join(directory, "#{tab}.csv"), "\uFEFF" + csv, encoding: 'UTF-8')
    end
  end

  def read_tab(tab, source)
    raise "Missing CSV source for #{tab}" if blank?(source)

    text = if source.match?(%r{\Ahttps://}i)
             URI.parse(source).open(open_timeout: 20, read_timeout: 60, &:read)
           else
             File.read(source)
           end
    text = text.dup.force_encoding('UTF-8').sub(/\A\uFEFF/, '')
    table = CSV.parse(text, headers: true)
    actual = table.headers.compact.map(&:strip)
    raise "Duplicate headers in #{tab}" unless actual.uniq == actual
    shared_headers = SHARED_FIELDS.fetch(tab, []).map { |field| column(field) }
    shared_headers << 'present' if SECTIONS.key?(tab)
    missing = headers(tab).reject do |header|
      actual.include?(header) || (shared_headers.include?(header) && LANGUAGES.all? { |lang| actual.include?("#{lang}_#{header}") })
    end
    raise "Missing #{tab} columns: #{missing.join(', ')}" unless missing.empty?

    table.each_with_index.filter_map do |row, index|
      values = row.to_h.transform_keys { |key| key.to_s.strip }
      next if values.values.all? { |value| blank?(value) }

      values.transform_values { |value| value&.strip }.merge('__row_number' => index + 2)
    end
  end

  def require_value(value, label)
    raise "Missing #{label}" if blank?(value)
    value
  end

  def boolean(value, label)
    return true if value.to_s.upcase == 'TRUE'
    return false if value.to_s.upcase == 'FALSE'

    raise "#{label} must be TRUE or FALSE"
  end

  def list(value)
    return [] if blank?(value)

    value.split(/\r?\n/).map(&:strip).reject(&:empty?)
  end

  def parse_item(row, tab, language)
    fields = SECTIONS.fetch(tab).last
    prefix = "#{language}_"
    label = "#{tab} row #{row.fetch('__row_number')} #{language}"
    return nil unless boolean(field_value(row, tab, 'present', language), "#{label} present")
    item = {}
    fields.each do |field|
      value = field_value(row, tab, field, language)
      next if %w[days times].include?(field)
      if field == 'descriptions'
        item[field] = list(value)
      elsif !blank?(value)
        item[field] = case field
                      when 'featured' then boolean(value, 'featured')
                      when 'start'
                        raise 'Instructor start must be a four-digit year' unless value.match?(/\A\d{4}\z/)
                        value.to_i
                      else value
                      end
      end
    end
    required = case tab
               when 'instructors' then %w[name start image]
               when 'schedules' then %w[title]
               when 'class_types' then %w[name perfect-for]
               when 'pricing' then %w[name]
               when 'faqs' then %w[q a]
               end
    required.each { |field| require_value(item[field], "#{label} #{field}") }
    if tab == 'schedules'
      days = list(row[prefix + 'days'])
      times = list(field_value(row, tab, 'times', language))
      raise 'Schedules need matching, nonempty days and times' if days.empty? || days.length != times.length
      item['descriptions'] = days.zip(times).map { |day, time| { 'description' => day, 'time' => time } }
    end
    item
  end

  def build_contact(rows, club_id)
    raise "#{club_id}: locations tab must contain exactly one row" unless rows.length == 1

    row = rows.first
    data = LOCATION_FIELDS.to_h { |field| [field, require_value(row[column(field)], "#{club_id} #{field}")] }
    raise 'Map and form URLs must use HTTPS' unless %w[address-link club-contact].all? { |field| data[field].start_with?('https://') }
    LOCATION_FIELDS.grep(/-id\z/).each do |field|
      raise "Invalid form field ID: #{field}" unless data[field].match?(/\Aentry\.\d+\z/)
    end
    data
  end

  def read_workbooks(sources, records)
    raise 'Configure one spreadsheet for every existing club, with no unknown IDs' unless sources.is_a?(Hash) && sources.keys.sort == records.keys.sort

    sources.to_h do |club_id, tabs|
      raise "Invalid tab configuration for #{club_id}" unless tabs.is_a?(Hash)
      tables = TABS.to_h { |tab| [tab, read_tab(tab, tabs[tab])] }
      raise "#{club_id}: clubs tab must contain exactly its own club row" unless tables['clubs'].length == 1 && tables['clubs'].first['club_id'] == club_id
      [club_id, tables]
    end
  end

  def build_locations(contacts, records)
    result = locations.dup
    records.each do |club_id, versions|
      location_id = versions.fetch('da')[:data].fetch('location')
      next unless club_id == location_id

      result[location_id] = result.fetch(location_id).merge(contacts.fetch(club_id))
    end
    result
  end

  def sync(sources)
    records = pages
    workbooks = read_workbooks(sources, records)
    contacts = workbooks.to_h { |club_id, tables| [club_id, build_contact(tables['locations'], club_id)] }
    new_locations = build_locations(contacts, records)
    updates = {}
    workbooks.each do |club_id, tables|
      row = tables['clubs'].first
      LANGUAGES.each do |language|
        original = records.fetch(club_id).fetch(language)
        data = original[:data].dup
        data.delete('contact')
        contact = contacts.fetch(club_id)
        data['contact'] = contact unless contact == new_locations.fetch(data.fetch('location')).slice(*LOCATION_FIELDS)
        CLUB_FIELDS.each do |field|
          value = field_value(row, 'clubs', field, language)
          data.delete(field)
          data[field] = field == 'interests' ? list(value) : value unless blank?(value)
        end
        %w[club-name description].each { |field| require_value(data[field], "#{club_id} #{language}_#{column(field)}") }
        SECTIONS.each do |tab, (key, _fields)|
          items = tables[tab].filter_map { |item_row| parse_item(item_row, tab, language) }
          raise "#{club_id} #{language}: #{tab} must contain at least one item" if tab != 'faqs' && items.empty?
          data.delete(key)
          data[key] = items unless items.empty?
        end
        next if data == original[:data]

        updates[original[:path]] = YAML.dump(data, line_width: -1) + "---\n" + original[:body]
      end
    end
    if new_locations != locations
      updates[File.join(@root, '_data', 'locations.yml')] = YAML.dump(new_locations, line_width: -1).sub(/\A---\n/, '')
    end
    updates.each { |path, text| File.write(path, text, encoding: 'UTF-8') }
    updates.keys
  end
end