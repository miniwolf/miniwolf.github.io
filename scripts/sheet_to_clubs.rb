require_relative 'club_sheets'

if $PROGRAM_NAME == __FILE__
  begin
    abort 'Usage: ruby scripts/sheet_to_clubs.rb [SOURCES_JSON_FILE]' if ARGV.length > 1
    config = ARGV.empty? ? ENV['CLUBS_SHEETS_CONFIG'] : File.read(ARGV[0], encoding: 'UTF-8')
    abort 'ERROR: Set CLUBS_SHEETS_CONFIG or provide a sources.json file.' if config.nil? || config.strip.empty?
    sources = JSON.parse(config)
    base = ARGV.empty? ? Dir.pwd : File.dirname(File.expand_path(ARGV[0]))
    if sources.is_a?(Hash)
      sources.each_value do |tabs|
        next unless tabs.is_a?(Hash)
        tabs.transform_values! do |source|
          source.is_a?(String) && !source.match?(%r{\Ahttps://}i) ? File.expand_path(source, base) : source
        end
      end
    end
    changed = ClubSheets.new(File.expand_path('..', __dir__)).sync(sources)
    puts changed.empty? ? 'No club changes.' : "Updated #{changed.length} club files."
  rescue StandardError => error
    abort "ERROR: #{error.message} (club data validation or fetch failed; no writes occur before validation completes)"
  end
end