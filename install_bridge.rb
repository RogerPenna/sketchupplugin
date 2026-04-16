require 'fileutils'

# 1. Detecta o caminho absoluto desta pasta de projeto
PROJECT_ROOT = File.expand_path(File.dirname(__FILE__))
MAIN_FILE = File.join(PROJECT_ROOT, 'main.rb')

# 2. Localiza a pasta de Plugins do SketchUp (Windows)
def find_plugins_folder
  appdata = ENV['APPDATA'].gsub("\\", "/")
  sketchup_base = File.join(appdata, 'SketchUp')
  
  # Busca a versão mais recente instalada (2021, 2022, 2023, 2024...)
  versions = Dir.glob(File.join(sketchup_base, 'SketchUp 20*')).sort.reverse
  
  if versions.empty?
    puts "Erro: Nenhuma pasta do SketchUp encontrada em \#{sketchup_base}"
    exit
  end

  # Retorna o caminho da pasta Plugins da versão mais recente
  File.join(versions.first, 'SketchUp/Plugins')
end

plugins_path = find_plugins_folder
bridge_file = File.join(plugins_path, 'road_creator_bridge.rb')

# 3. Conteúdo do arquivo de ponte
bridge_content = <<~RUBY
  # Ponte de Desenvolvimento - Road Creator
  # Este arquivo aponta para o seu diretório de trabalho externo.
  
  path = '#{MAIN_FILE}'
  if File.exist?(path)
    load path
    puts "Road Creator: Carregado com sucesso de #{PROJECT_ROOT}"
  else
    puts "Erro: Nao foi possivel encontrar o arquivo main.rb em \#{path}"
  end
RUBY

# 4. Escreve o arquivo na pasta de Plugins do SketchUp
begin
  File.write(bridge_file, bridge_content)
  puts "=========================================================="
  puts "SUCESSO!"
  puts "Ponte criada em: #{bridge_file}"
  puts "Apontando para: #{MAIN_FILE}"
  puts "Reinicie o SketchUp para ver a Toolbar 'Road Creator'."
  puts "=========================================================="
rescue => e
  puts "Erro ao criar a ponte: #{e.message}"
end
