require 'sketchup.rb'

module RogerioPenna
  module RoadCreator

    # Banco de Dados Completo
    NodeData = Struct.new(:pos, :left_h, :right_h, :lane_l, :lane_r, :sw_l, :sw_r, :follow_terrain, :max_dev, :manual_h)
    
    @dialog = nil

    class RoadTool
      SUBDIV_SEGMENTS = 24
      
      def initialize
        @nodes = [] 
        @selected_idx = nil
        @picked_idx = nil
        @picked_part = nil # :pos, :left_h, :right_h
      end

      def activate
        puts ">>> RoadTool: Reconstruindo com Bezier e Real-Time"
        setup_camera
        create_dialog
        Sketchup.active_model.active_view.invalidate
      end

      def setup_camera
        view = Sketchup.active_model.active_view
        view.camera.perspective = false
        # Aponta para o chão vindo do alto (100m)
        view.camera.set([0, 0, 100.m], [0, 0, 0], [0, 1, 0])
      end

      def create_dialog
        @dialog = UI::HtmlDialog.new({
          :dialog_title => "Road Properties (Real-Time)",
          :width => 320, :height => 600,
          :style => UI::HtmlDialog::STYLE_UTILITY
        })
        
        html = <<-HTML
          <html><head><style>
            body { font-family: 'Segoe UI', sans-serif; font-size: 11px; padding: 15px; background: #f0f0f0; }
            .card { background: white; padding: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .field { margin-bottom: 8px; }
            label { display: block; font-weight: bold; color: #666; font-size: 9px; text-transform: uppercase; }
            input { width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
            .row { display: flex; gap: 8px; } .row > div { flex: 1; }
            #ui { display: none; }
            h2 { margin: 0 0 10px 0; font-size: 14px; color: #0078d4; text-align: center; border-bottom: 1px solid #0078d4; padding-bottom: 5px; }
            .status-bar { font-size: 9px; color: #28a745; text-align: center; margin-top: 5px; font-weight: bold; }
          </style></head>
          <body>
            <div id="msg" style="text-align:center; color:#999; margin-top:50px;">Select a Node</div>
            <div id="ui" class="card">
              <h2>NODE EDITOR</h2>
              <div class="row">
                <div class="field"><label>X (m)</label><input type="number" id="nx" step="0.01" oninput="update()"></div>
                <div class="field"><label>Y (m)</label><input type="number" id="ny" step="0.01" oninput="update()"></div>
                <div class="field"><label>Z (m)</label><input type="number" id="nz" step="0.01" oninput="update()"></div>
              </div>
              <hr>
              <div class="row">
                <div class="field"><label>Lane Left</label><input type="number" id="nll" step="0.1" oninput="update()"></div>
                <div class="field"><label>Lane Right</label><input type="number" id="nlr" step="0.1" oninput="update()"></div>
              </div>
              <div class="row">
                <div class="field"><label>SW Left</label><input type="number" id="nsl" step="0.1" oninput="update()"></div>
                <div class="field"><label>SW Right</label><input type="number" id="nsr" step="0.1" oninput="update()"></div>
              </div>
              <div class="field"><label><input type="checkbox" id="nft" onchange="update()" style="width:auto;"> Follow Terrain</label></div>
              <div class="field"><label>Max Dev %</label><input type="number" id="nmd" oninput="update()"></div>
              <div id="status" class="status-bar"></div>
            </div>
            <script>
              function update() {
                const data = {
                  x: document.getElementById('nx').value,
                  y: document.getElementById('ny').value,
                  z: document.getElementById('nz').value,
                  ll: document.getElementById('nll').value,
                  lr: document.getElementById('nlr').value,
                  sl: document.getElementById('nsl').value,
                  sr: document.getElementById('nsr').value,
                  ft: document.getElementById('nft').checked,
                  md: document.getElementById('nmd').value
                };
                sketchup.on_update(data);
                document.getElementById('status').innerText = "SYNCING...";
                setTimeout(() => { document.getElementById('status').innerText = "LIVE"; }, 500);
              }
              window.loadNode = function(x,y,z,ll,lr,sl,sr,ft,md) {
                document.getElementById('msg').style.display = 'none';
                document.getElementById('ui').style.display = 'block';
                document.getElementById('nx').value = x; document.getElementById('ny').value = y; document.getElementById('nz').value = z;
                document.getElementById('nll').value = ll; document.getElementById('nlr').value = lr;
                document.getElementById('nsl').value = sl; document.getElementById('nsr').value = sr;
                document.getElementById('nft').checked = ft; document.getElementById('nmd').value = md;
                document.getElementById('status').innerText = "LIVE";
              }
            </script>
          </body></html>
        HTML
        
        @dialog.set_html(html)
        @dialog.add_action_callback("on_update") { |ctx, d|
          if @selected_idx && @nodes[@selected_idx]
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
        }
        @dialog.show
      end

      def sync_ui
        return unless @dialog && @selected_idx
        n = @nodes[@selected_idx]
        js = "loadNode(#{n.pos.x.to_m.round(3)}, #{n.pos.y.to_m.round(3)}, #{n.pos.z.to_m.round(3)}, "
        js += "#{n.lane_l.to_m.round(2)}, #{n.lane_r.to_m.round(2)}, #{n.sw_l.to_m.round(2)}, #{n.sw_r.to_m.round(2)}, "
        js += "#{n.follow_terrain}, #{n.max_dev})"
        @dialog.execute_script(js)
      end

      def onLButtonDown(flags, x, y, view)
        @picked_idx = nil
        @nodes.each_with_index do |n, i|
          [:pos, :left_h, :right_h].each do |p|
            sp = view.screen_coords(n[p])
            if Math.sqrt((sp.x-x)**2 + (sp.y-y)**2) < 15
              @picked_idx, @picked_part = i, p
              if p == :pos; @selected_idx = i; sync_ui; end
              return view.invalidate
            end
          end
        end

        ip = view.inputpoint(x, y); pos = ip.position
        dir = @nodes.empty? ? Geom::Vector3d.new(5.m, 0, 0) : (pos - @nodes.last.pos)
        dir = Geom::Vector3d.new(5.m, 0, 0) unless dir.valid?; dir.length = 5.m
        
        @nodes << NodeData.new(pos, pos.offset(dir.reverse), pos.offset(dir), 3.5.m, 3.5.m, 1.5.m, 1.5.m, true, 5.0, false)
        @selected_idx = @nodes.size - 1
        @picked_idx, @picked_part = @selected_idx, :pos
        sync_ui
        view.invalidate
      end

      def onMouseMove(flags, x, y, view)
        if @picked_idx && @picked_part
          node = @nodes[@picked_idx]; old = node[@picked_part].clone; node[@picked_part] = view.inputpoint(x, y).position
          if @picked_part == :pos
            delta = node.pos - old
            node.left_h = node.left_h.offset(delta); node.right_h = node.right_h.offset(delta)
            sync_ui if @picked_idx == @selected_idx
          else
            opp = (@picked_part == :left_h ? :right_h : :left_h)
            node[opp] = node.pos.offset(node.pos - node[@picked_part])
          end
        end
        view.invalidate
      end

      def draw(view)
        return if @nodes.empty?
        all = []
        @nodes.each_cons(2) do |n1, n2|
          (0..SUBDIV_SEGMENTS).each do |i|
            t = i.to_f / SUBDIV_SEGMENTS; inv = 1.0 - t
            p = Geom::Point3d.new(
              inv**3*n1.pos.x + 3*inv**2*t*n1.right_h.x + 3*inv*t**2*n2.left_h.x + t**3*n2.pos.x,
              inv**3*n1.pos.y + 3*inv**2*t*n1.right_h.y + 3*inv*t**2*n2.left_h.y + t**3*n2.pos.y,
              inv**3*n1.pos.z + 3*inv**2*t*n1.right_h.z + 3*inv*t**2*n2.left_h.z + t**3*n2.pos.z
            )
            all << {pos: p, ll: n1.lane_l+(n2.lane_l-n1.lane_l)*t, lr: n1.lane_r+(n2.lane_r-n1.lane_r)*t, sl: n1.sw_l+(n2.sw_l-n1.sw_l)*t, sr: n1.sw_r+(n2.sw_r-n1.sw_r)*t}
          end
        end

        if all.size >= 2
          pts_c = all.map{|d| d[:pos]}
          view.drawing_color = "black"; view.line_width = 3; view.draw(GL_LINE_STRIP, pts_c)
          l_lane, r_lane, l_sw, r_sw = [], [], [], []
          all.each_with_index do |d, i|
            v1 = i > 0 ? (d[:pos] - all[i-1][:pos]).normalize : nil
            v2 = i < all.size-1 ? (all[i+1][:pos] - d[:pos]).normalize : nil
            dir = (v1 && v2) ? (v1+v2).normalize : (v1 || v2)
            next unless dir && dir.valid?
            perp = Geom::Vector3d.new(-dir.y, dir.x, 0)
            l_lane << d[:pos].offset(perp, d[:ll]); r_lane << d[:pos].offset(perp, -d[:lr])
            l_sw << d[:pos].offset(perp, d[:ll] + d[:sl]); r_sw << d[:pos].offset(perp, -(d[:lr] + d[:sr]))
          end
          view.line_width = 1
          view.drawing_color = [33, 150, 243]; view.draw(GL_LINE_STRIP, l_lane); view.draw(GL_LINE_STRIP, r_lane)
          view.drawing_color = [120, 120, 120]; view.draw(GL_LINE_STRIP, l_sw); view.draw(GL_LINE_STRIP, r_sw)
        end

        @nodes.each_with_index do |n, i|
          view.drawing_color = "gray"; view.draw(GL_LINES, [n.left_h, n.pos, n.pos, n.right_h])
          view.draw_points([n.pos], 12, 4, (i == @selected_idx ? "yellow" : "blue"))
          view.draw_points([n.left_h, n.right_h], 8, 2, "cyan")
        end
      end

      def onLButtonUp(f,x,y,v); @picked_idx = nil; v.invalidate; end
    end

    def self.setup_ui
      @toolbar = UI::Toolbar.new("Road Creator")
      cmd_draw = UI::Command.new("Desenhar") { Sketchup.active_model.select_tool(RoadTool.new) }
      cmd_reload = UI::Command.new("Recarregar") { load __FILE__; puts ">>> Plugin Atualizado" }
      @toolbar.add_item(cmd_draw)
      @toolbar.add_item(cmd_reload)
      @toolbar.show
    end

    if !file_loaded?(__FILE__)
      setup_ui
      file_loaded(__FILE__)
    end
  end
end
