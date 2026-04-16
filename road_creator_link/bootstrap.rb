require 'sketchup.rb'

module RogerioPenna
  module RoadCreatorLink

    def self.setup_bridge
      # 1. Solicita ao usuário que selecione a pasta de desenvolvimento
      chosen_path = UI.select_directory(
        title: "Selecione a pasta onde esta o seu arquivo 'main.rb'",
        directory: "C:/"
      )

      return if chosen_path.nil?

      chosen_path = chosen_path.gsub("\\", "/")
      main_file_path = File.join(chosen_path, "main.rb")

      unless File.exist?(main_file_path)
        UI.messagebox("Erro: O arquivo 'main.rb' nao foi encontrado em: \n#{chosen_path}")
        return
      end

      plugins_dir = Sketchup.find_support_file("Plugins")
      bridge_file = File.join(plugins_dir, "dev_bridge_to_road_creator.rb")

      # 4. Criando o conteúdo SEM usar interpolação de string dentro do heredoc para evitar conflitos
      line1 = "# Ponte de Desenvolvimento - Road Creator"
      line2 = "load '#{main_file_path}'"
      line3 = "puts 'Road Creator carregado via ponte de dev'"
      
      bridge_content = [line1, line2, line3].join("\n")

      begin
        File.write(bridge_file, bridge_content)
        UI.messagebox("Sucesso! Link configurado.\n\nArquivo criado: #{bridge_file}")
        load bridge_file 
      rescue => e
        UI.messagebox("Erro ao criar a ponte: #{e.message}")
      end
    end

    # Verifica se a ponte existe
    plugins_dir = Sketchup.find_support_file("Plugins")
    bridge_file = File.join(plugins_dir, "dev_bridge_to_road_creator.rb")

    unless File.exist?(bridge_file)
      UI.start_timer(0.5, false) { self.setup_bridge }
    end

    unless file_loaded?(__FILE__)
      menu = UI.menu('Extensions')
      sub_menu = menu.add_submenu('Road Creator Dev')
      sub_menu.add_item('Reconfigurar Pasta de Projeto') { self.setup_bridge }
      file_loaded(__FILE__)
    end
  end
end
