module RogerioPenna
  module RoadCreator
    module Geometry
      def self.generate_bezier_path(n1, n2, segments)
        (0..segments).map do |i|
          t = i.to_f / segments
          inv = 1.0 - t
          p = Geom::Point3d.new(
            inv**3*n1.pos.x + 3*inv**2*t*n1.right_h.x + 3*inv*t**2*n2.left_h.x + t**3*n2.pos.x,
            inv**3*n1.pos.y + 3*inv**2*t*n1.right_h.y + 3*inv*t**2*n2.left_h.y + t**3*n2.pos.y,
            inv**3*n1.pos.z + 3*inv**2*t*n1.right_h.z + 3*inv*t**2*n2.left_h.z + t**3*n2.pos.z
          )
          # Interpolação de atributos
          {
            pos: p,
            ll: n1.lane_l + (n2.lane_l - n1.lane_l) * t,
            lr: n1.lane_r + (n2.lane_r - n1.lane_r) * t,
            sl: n1.sw_l + (n2.sw_l - n1.sw_l) * t,
            sr: n1.sw_r + (n2.sw_r - n1.sw_r) * t
          }
        end
      end

      def self.calculate_all_edges(all_data)
        edges = []
        all_data.each_with_index do |d, i|
          v1 = i > 0 ? (d[:pos] - all_data[i-1][:pos]).normalize : nil
          v2 = i < all_data.size - 1 ? (all_data[i+1][:pos] - d[:pos]).normalize : nil
          dir = (v1 && v2) ? (v1 + v2).normalize : (v1 || v2)
          next unless dir && dir.valid?
          perp = Geom::Vector3d.new(-dir.y, dir.x, 0)
          
          edges << {
            center: d[:pos],
            l_lane: d[:pos].offset(perp, d[:ll]),
            r_lane: d[:pos].offset(perp, -d[:lr]),
            l_sw: d[:pos].offset(perp, d[:ll] + d[:sl]),
            r_sw: d[:pos].offset(perp, -(d[:lr] + d[:sr]))
          }
        end
        edges
      end
    end
  end
end
