module RogerioPenna
  module RoadCreator
    # Adicionado :width para evitar erro de argumentos
    NodeData = Struct.new(:pos, :left_h, :right_h, :width, :lane_l, :lane_r, :sw_l, :sw_r, :follow_terrain, :max_dev, :manual_h)
  end
end
