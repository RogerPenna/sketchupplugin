require 'sketchup.rb'
require 'extensions.rb'

module RogerioPenna
  module RoadCreatorLink
    unless file_loaded?(__FILE__)
      ex = SketchupExtension.new('Road Creator Dev Link', 'road_creator_link/bootstrap.rb')
      ex.description = 'Configura automaticamente o link de desenvolvimento para a pasta externa do Road Creator.'
      ex.version     = '1.0.0'
      ex.creator     = 'Rogerio Penna'
      ex.copyright   = '2024, Rogerio Penna'
      
      Sketchup.register_extension(ex, true)
      file_loaded(__FILE__)
    end
  end
end
