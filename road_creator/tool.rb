module RogerioPenna
  module RoadCreator
    class RoadTool
      SUBDIV_SEGMENTS = 24
      
      def initialize
        @nodes = [] 
        @selected_idx = nil
        @picked_idx = nil
        @picked_part = nil
        @dialog = nil
      end

      def activate
        view = Sketchup.active_model.active_view
        @dialog = EditorDialog.new(self)
        @dialog.show
        view.invalidate
      end

      def getBounds
        view = Sketchup.active_model.active_view
        bounds = Geom::BoundingBox.new
        if @nodes.empty?
          bounds.add([0,0,0])
        else
          @nodes.each { |n| bounds.add(n.pos); bounds.add(n.left_h); bounds.add(n.right_h) }
          # Bounding box simples e estável
          bounds.inflate(5.m)
        end
        bounds
      end

      def deactivate(view)
        @dialog.close if @dialog
      end

      def update_selected_node(d)
        return if @selected_idx.nil? || @nodes[@selected_idx].nil?
        n = @nodes[@selected_idx]
        n.lane_l, n.lane_r = d['ll'].to_f.m, d['lr'].to_f.m
        n.sw_l, n.sw_r = d['sl'].to_f.m, d['sr'].to_f.m
        n.follow_terrain, n.max_dev = d['ft'], d['md'].to_f
        new_p = Geom::Point3d.new(d['x'].to_f.m, d['y'].to_f.m, d['z'].to_f.m)
        delta = new_p - n.pos
        if delta.length > 0.001
          n.pos = new_p
          n.left_h = n.left_h.offset(delta); n.right_h = n.right_h.offset(delta)
        end
        Sketchup.active_model.active_view.invalidate
      end

      def create_real_geometry
        return if @nodes.size < 2
        model = Sketchup.active_model
        model.start_operation('Generate Road', true)
        
        group = model.active_entities.add_group
        entities = group.entities
        
        all_data = []
        @nodes.each_cons(2) { |n1, n2| all_data.concat(Geometry.generate_bezier_path(n1, n2, SUBDIV_SEGMENTS)[0...-1]) }
        last = @nodes.last; all_data << {pos: last.pos, ll: last.lane_l, lr: last.lane_r, sl: last.sw_l, sr: last.sw_r}
        edges = Geometry.calculate_all_edges(all_data)

        edges.each_cons(2) do |e1, e2|
          begin
            # Lane Esquerda
            f = entities.add_face(e1[:center], e2[:center], e2[:l_lane], e1[:l_lane])
            f.reverse! if f.normal.dot(Z_AXIS) < 0
            # Lane Direita
            f = entities.add_face(e1[:center], e1[:r_lane], e2[:r_lane], e2[:center])
            f.reverse! if f.normal.dot(Z_AXIS) < 0
            # SW Esquerda
            f = entities.add_face(e1[:l_lane], e2[:l_lane], e2[:l_sw], e1[:l_sw])
            f.reverse! if f.normal.dot(Z_AXIS) < 0
            # SW Direita
            f = entities.add_face(e1[:r_lane], e1[:r_sw], e2[:r_sw], e2[:r_lane])
            f.reverse! if f.normal.dot(Z_AXIS) < 0
          rescue
            next
          end
        end

        model.commit_operation
      end

      def onLButtonDown(flags, x, y, view)
        found = false
        @nodes.each_with_index do |n, i|
          [:pos, :left_h, :right_h].each do |part|
            sp = view.screen_coords(n[part])
            if Math.sqrt((sp.x-x)**2 + (sp.y-y)**2) < 20
              @picked_idx, @picked_part = i, part
              if part == :pos; @selected_idx = i; @dialog.update_node(n); end
              found = true; break
            end
          end
          break if found
        end
        unless found
          ip = view.inputpoint(x, y); pos = ip.position
          dir = @nodes.empty? ? Geom::Vector3d.new(5.m, 0, 0) : (pos - @nodes.last.pos)
          dir = Geom::Vector3d.new(5.m, 0, 0) unless dir.valid?; dir.length = 5.m
          new_node = NodeData.new(pos, pos.offset(dir.reverse), pos.offset(dir), 8.m, 3.5.m, 3.5.m, 1.5.m, 1.5.m, true, 5.0, false)
          @nodes << new_node; @selected_idx = @nodes.size - 1; @dialog.update_node(new_node)
        end
        view.invalidate
      end

      def onMouseMove(flags, x, y, view)
        if @picked_idx && @picked_part
          pos = view.inputpoint(x, y).position
          node = @nodes[@picked_idx]; old_pos = node[@picked_part].clone; node[@picked_part] = pos
          if @picked_part == :pos
            delta = pos - old_pos
            node.left_h = node.left_h.offset(delta); node.right_h = node.right_h.offset(delta)
            @dialog.sync_coords(node.pos) if @picked_idx == @selected_idx
          else
            node[(@picked_part == :left_h ? :right_h : :left_h)] = node.pos.offset(node.pos - pos)
          end
          view.invalidate
        end
      end

      def onLButtonUp(flags, x, y, view); @picked_idx = nil; view.invalidate; end

      def draw(view)
        begin
          return if @nodes.empty?
          
          all_data = []
          @nodes.each_cons(2) { |n1, n2| all_data.concat(Geometry.generate_bezier_path(n1, n2, SUBDIV_SEGMENTS)[0...-1]) }
          last = @nodes.last; all_data << {pos: last.pos, ll: last.lane_l, lr: last.lane_r, sl: last.sw_l, sr: last.sw_r}

          if all_data.size >= 2
            edges = Geometry.calculate_all_edges(all_data)
            # Offset fixo para 3D
            z_f = Geom::Vector3d.new(0, 0, 10.mm)
            z_l = Geom::Vector3d.new(0, 0, 11.mm)
            
            edges.each_cons(2) do |e1, e2|
              # Lane (Alpha 254 força o pipeline de transparência que costuma ignorar bugs de scissor do driver)
              p1, p2, p3, p4 = e1[:l_lane].offset(z_f), e1[:r_lane].offset(z_f), e2[:r_lane].offset(z_f), e2[:l_lane].offset(z_f)
              view.drawing_color = [160, 160, 160, 254]
              view.draw(GL_TRIANGLES, [p1, p2, p3, p1, p3, p4])
              
              # SW Esquerda
              p1, p2, p3, p4 = e1[:l_sw].offset(z_f), e1[:l_lane].offset(z_f), e2[:l_lane].offset(z_f), e2[:l_sw].offset(z_f)
              view.drawing_color = [210, 210, 210, 254]
              view.draw(GL_TRIANGLES, [p1, p2, p3, p1, p3, p4])

              # SW Direita
              p1, p2, p3, p4 = e1[:r_lane].offset(z_f), e1[:r_sw].offset(z_f), e2[:r_sw].offset(z_f), e2[:r_lane].offset(z_f)
              view.drawing_color = [210, 210, 210, 254]
              view.draw(GL_TRIANGLES, [p1, p2, p3, p1, p3, p4])
              
              # Wires
              view.drawing_color = [0, 0, 0, 254]; view.line_width = 1
              l1, l2 = e1[:l_sw].offset(z_l), e2[:l_sw].offset(z_l)
              r1, r2 = e1[:r_sw].offset(z_l), e2[:r_sw].offset(z_l)
              view.draw(GL_LINES, [l1, l2, r1, r2, l1, r1])
            end
            
            # Fechamento final das wires
            last_e = edges.last
            view.draw(GL_LINES, [last_e[:l_sw].offset(z_l), last_e[:r_sw].offset(z_l)])
          end

          # UI Controls
          @nodes.each_with_index do |n, i|
            view.drawing_color = [128, 128, 128, 254]; view.line_width = 1
            view.draw(GL_LINES, [n.left_h, n.pos, n.pos, n.right_h])
            
            view.draw_points([n.pos], 14, 4, (i == @selected_idx ? "yellow" : "blue"))
            view.draw_points([n.left_h, n.right_h], 10, 2, "cyan")
          end
        rescue => e; puts ">>> DRAW ERROR: #{e.message}"; end
      end
    end
  end
end
