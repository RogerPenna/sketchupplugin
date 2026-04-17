module RogerioPenna
  module RoadCreator
    class EditorDialog
      def initialize(tool_instance)
        @tool = tool_instance
        @dialog = UI::HtmlDialog.new({
          :dialog_title => "Road Node Editor",
          :width => 320, :height => 620,
          :style => UI::HtmlDialog::STYLE_UTILITY
        })
        setup_callbacks
        @dialog.set_html(html_content)
      end

      def show; @dialog.show unless @dialog.visible?; end
      def close; @dialog.close if @dialog; end

      def update_node(node)
        return unless @dialog.visible?
        js = "loadNode(#{node.pos.x.to_m.round(3)}, #{node.pos.y.to_m.round(3)}, #{node.pos.z.to_m.round(3)}, "
        js += "#{node.lane_l.to_m.round(2)}, #{node.lane_r.to_m.round(2)}, #{node.sw_l.to_m.round(2)}, #{node.sw_r.to_m.round(2)}, "
        js += "#{node.follow_terrain}, #{node.max_dev})"
        @dialog.execute_script(js)
      end

      def sync_coords(pos)
        return unless @dialog.visible?
        @dialog.execute_script("updatePos(#{pos.x.to_m.round(3)}, #{pos.y.to_m.round(3)}, #{pos.z.to_m.round(3)})")
      end

      private

      def setup_callbacks
        @dialog.add_action_callback("on_update") { |ctx, d| @tool.update_selected_node(d) }
        @dialog.add_action_callback("generate_geo") { |ctx, d| @tool.create_real_geometry }
      end

      def html_content
        <<-HTML
          <html><head><style>
            body { font-family: 'Segoe UI', sans-serif; font-size: 11px; padding: 15px; background: #f0f0f0; }
            .card { background: white; padding: 15px; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .field { margin-bottom: 8px; }
            label { display: block; font-weight: bold; color: #666; font-size: 9px; text-transform: uppercase; }
            input { width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
            .row { display: flex; gap: 8px; } .row > div { flex: 1; }
            #ui { display: none; }
            h2 { margin: 0 0 10px 0; font-size: 14px; color: #0078d4; text-align: center; border-bottom: 1px solid #0078d4; padding-bottom: 5px; }
            button { width: 100%; padding: 10px; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; margin-top: 10px; }
            .btn-update { background: #28a745; color: white; }
            .btn-geo { background: #0078d4; color: white; margin-top: 20px; }
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
                <div class="field"><label>Lane L</label><input type="number" id="nll" step="0.1" oninput="update()"></div>
                <div class="field"><label>Lane R</label><input type="number" id="nlr" step="0.1" oninput="update()"></div>
              </div>
              <div class="row">
                <div class="field"><label>SW L</label><input type="number" id="nsl" step="0.1" oninput="update()"></div>
                <div class="field"><label>SW R</label><input type="number" id="nsr" step="0.1" oninput="update()"></div>
              </div>
              <div class="field"><label><input type="checkbox" id="nft" onchange="update()"> Follow Terrain</label></div>
              <div class="field"><label>Max Dev %</label><input type="number" id="nmd" oninput="update()"></div>
              
              <button class="btn-geo" onclick="sketchup.generate_geo()">GENERATE GEOMETRY</button>
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
              }
              window.loadNode = function(x,y,z,ll,lr,sl,sr,ft,md) {
                document.getElementById('msg').style.display = 'none';
                document.getElementById('ui').style.display = 'block';
                document.getElementById('nx').value = x; document.getElementById('ny').value = y; document.getElementById('nz').value = z;
                document.getElementById('nll').value = ll; document.getElementById('nlr').value = lr;
                document.getElementById('nsl').value = sl; document.getElementById('nsr').value = sr;
                document.getElementById('nft').checked = ft; document.getElementById('nmd').value = md;
              }
              window.updatePos = function(x, y, z) {
                if (document.activeElement.tagName !== 'INPUT') {
                  document.getElementById('nx').value = x;
                  document.getElementById('ny').value = y;
                  document.getElementById('nz').value = z;
                }
              }
            </script>
          </body></html>
        HTML
      end
    end
  end
end
