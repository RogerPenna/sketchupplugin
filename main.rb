require 'sketchup.rb'

module RogerioPenna
  module RoadCreator
    def self.reload
      puts ">>> Road Creator: Recarregando componentes..."
      root = File.dirname(__FILE__)
      files = [
        'road_creator/data.rb',
        'road_creator/logic.rb',
        'road_creator/ui.rb',
        'road_creator/tool.rb'
      ]
      files.each { |f| load File.join(root, f) }
      puts ">>> Road Creator: Componentes recarregados com sucesso."
    end

    def self.setup_ui
      # Só cria e adiciona botões se a toolbar ainda não estiver pronta
      if !file_loaded?(__FILE__)
        @toolbar = UI::Toolbar.new("Road Creator")
        
        cmd_draw = UI::Command.new("Desenhar") { 
          Sketchup.active_model.select_tool(RoadTool.new) 
        }
        cmd_draw.tooltip = "Desenhar Estrada (Preview Sólido)"
        
        cmd_reload = UI::Command.new("Recarregar") { 
          self.reload 
        }
        cmd_reload.tooltip = "Recarregar código"
        
        @toolbar.add_item(cmd_draw)
        @toolbar.add_item(cmd_reload)
        @toolbar.show
        
        file_loaded(__FILE__)
      end
    end

    # Carrega os arquivos
    self.reload
    self.setup_ui
  end
end
