var CONF = {
    image: {
        width: 50,
        height: 40
    },
    //d3的force
    force: {
        width: 960,
        height: 500,
        dist: 200,
        charge: -600
    }
};
//ws长链接
var ws = new WebSocket("ws://" + location.host + "/v1.0/topology/ws");
ws.onmessage = function(event) {
    var data = JSON.parse(event.data);

    var result = rpc[data.method](data.params);

    var ret = { "id": data.id, "jsonrpc": "2.0", "result": result };
    this.send(JSON.stringify(ret));
}

function trim_zero(obj) {
    return String(obj).replace(/^0+/, "");
}

function dpid_to_int(dpid) {
    return Number("0x" + dpid);
}
//整个页面节点 类似vue根元素
var elem = {
    //设置d3force  相关文档：https://www.d3js.org.cn/document/d3-force/#d3-force
    force: d3.layout.force()
        .size([CONF.force.width, CONF.force.height])
        .charge(CONF.force.charge)
        .linkDistance(CONF.force.dist)
        .on("tick", _tick),
    //绘制路由器
    svg: d3.select("body").append("svg")
        .attr("id", "topology")
        .attr("width", CONF.force.width)
        .attr("height", CONF.force.height),
    //绘制console
    console: d3.select("body").append("div")
        .attr("id", "console")
        .attr("width", CONF.force.width)
};

function _tick() {
    elem.link.attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

    elem.node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });

    elem.port.attr("transform", function(d) {
        var p = topo.get_port_point(d);
        return "translate(" + p.x + "," + p.y + ")";
    });
}
//拖拽api  v3文档https://github.com/xswei/d3js_doc/blob/master/Release_Notes/CHANGES.md#draggingd3-drag
elem.drag = elem.force.drag().on("dragstart", _dragstart);

function _dragstart(d) {
    var dpid = dpid_to_int(d.dpid)
    d3.json("/stats/flow/" + dpid, function(e, data) {
        flows = data[dpid];
        console.log(flows);
        elem.console.selectAll("ul").remove();
        li = elem.console.append("ul")
            .selectAll("li");
        li.data(flows).enter().append("li")
            .text(function(d) { return JSON.stringify(d, null, " "); });
    });
    d3.select(this).classed("fixed", d.fixed = true);
}
//d3 API:https://www.d3js.org.cn/document/d3-selection/#installing 
//定义node link port
elem.node = elem.svg.selectAll(".node");
elem.link = elem.svg.selectAll(".link");
elem.port = elem.svg.selectAll(".port");
//更新elem中各节点、连线
elem.update = function() {
    this.force
        .nodes(topo.nodes)
        .links(topo.links)
        .start();

    this.link = this.link.data(topo.links);
    this.link.exit().remove();
    this.link.enter().append("line")
        .attr("class", "link");

    this.node = this.node.data(topo.nodes);
    this.node.exit().remove();
    var nodeEnter = this.node.enter().append("g")
        .attr("class", "node")
        .on("dblclick", function(d) { d3.select(this).classed("fixed", d.fixed = false); })
        .call(this.drag);
    nodeEnter.append("image")
        .attr("xlink:href", "./router.svg")
        .attr("x", -CONF.image.width / 2)
        .attr("y", -CONF.image.height / 2)
        .attr("width", CONF.image.width)
        .attr("height", CONF.image.height);
    nodeEnter.append("text")
        .attr("dx", -CONF.image.width / 2)
        .attr("dy", CONF.image.height - 10)
        .text(function(d) { return "dpid: " + trim_zero(d.dpid); });

    var ports = topo.get_ports();
    this.port.remove();
    this.port = this.svg.selectAll(".port").data(ports);
    var portEnter = this.port.enter().append("g")
        .attr("class", "port");
    portEnter.append("circle")
        .attr("r", 8);
    portEnter.append("text")
        .attr("dx", -3)
        .attr("dy", 3)
        .text(function(d) { return trim_zero(d.port_no); });
};
//判断连线是否有效
function is_valid_link(link) {
    return (link.src.dpid < link.dst.dpid)
}
//定义拓扑节点、方法
// todo : 添加主机节点,主机拓扑连线逻辑和switch不同，方法逻辑需改写
var topo = {
    nodes: [],
    links: [],
    node_index: {}, // dpid -> index of nodes array
    initialize: function(data) {

        this.add_nodes(data.switches);
        this.add_links(data.links);
        //this.add_nodes(data.hosts)
    },
    add_nodes: function(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            this.nodes.push(nodes[i]);
        }
        this.refresh_node_index();
    },
    add_links: function(links) {
        for (var i = 0; i < links.length; i++) {
            if (!is_valid_link(links[i])) continue;
            console.log("add link: " + JSON.stringify(links[i]));

            var src_dpid = links[i].src.dpid;
            var dst_dpid = links[i].dst.dpid;
            var src_index = this.node_index[src_dpid];
            var dst_index = this.node_index[dst_dpid];
            var link = {
                source: src_index,
                target: dst_index,
                port: {
                    src: links[i].src,
                    dst: links[i].dst
                }
            }
            this.links.push(link);
        }
    },
    delete_nodes: function(nodes) {
        for (var i = 0; i < nodes.length; i++) {
            console.log("delete switch: " + JSON.stringify(nodes[i]));

            node_index = this.get_node_index(nodes[i]);
            this.nodes.splice(node_index, 1);
        }
        this.refresh_node_index();
    },
    delete_links: function(links) {
        for (var i = 0; i < links.length; i++) {
            if (!is_valid_link(links[i])) continue;
            console.log("delete link: " + JSON.stringify(links[i]));

            link_index = this.get_link_index(links[i]);
            this.links.splice(link_index, 1);
        }
    },
    get_node_index: function(node) {
        for (var i = 0; i < this.nodes.length; i++) {
            if (node.dpid == this.nodes[i].dpid) {
                return i;
            }
        }
        return null;
    },
    get_link_index: function(link) {
        for (var i = 0; i < this.links.length; i++) {
            if (link.src.dpid == this.links[i].port.src.dpid &&
                link.src.port_no == this.links[i].port.src.port_no &&
                link.dst.dpid == this.links[i].port.dst.dpid &&
                link.dst.port_no == this.links[i].port.dst.port_no) {
                return i;
            }
        }
        return null;
    },
    get_ports: function() {
        var ports = [];
        var pushed = {};
        for (var i = 0; i < this.links.length; i++) {
            function _push(p, dir) {
                key = p.dpid + ":" + p.port_no;
                if (key in pushed) {
                    return 0;
                }

                pushed[key] = true;
                p.link_idx = i;
                p.link_dir = dir;
                return ports.push(p);
            }
            _push(this.links[i].port.src, "source");
            _push(this.links[i].port.dst, "target");
        }

        return ports;
    },
    get_port_point: function(d) {
        var weight = 0.88;

        var link = this.links[d.link_idx];
        var x1 = link.source.x;
        var y1 = link.source.y;
        var x2 = link.target.x;
        var y2 = link.target.y;

        if (d.link_dir == "target") weight = 1.0 - weight;

        var x = x1 * weight + x2 * (1.0 - weight);
        var y = y1 * weight + y2 * (1.0 - weight);

        return { x: x, y: y };
    },
    refresh_node_index: function() {
        this.node_index = {};
        for (var i = 0; i < this.nodes.length; i++) {
            this.node_index[this.nodes[i].dpid] = i;
        }
    },
}

var rpc = {
    //todo ：增加主机相关操作
    //enter：添加新路由节点
    event_switch_enter: function(params) {
        var switches = [];
        for (var i = 0; i < params.length; i++) {
            switches.push({ "dpid": params[i].dpid, "ports": params[i].ports });
        }
        topo.add_nodes(switches);
        elem.update();
        return "";
    },
    //删除路由节点
    event_switch_leave: function(params) {
        var switches = [];
        for (var i = 0; i < params.length; i++) {
            switches.push({ "dpid": params[i].dpid, "ports": params[i].ports });
        }
        topo.delete_nodes(switches);
        elem.update();
        return "";
    },
    //拓扑连线
    event_link_add: function(links) {
        topo.add_links(links);
        elem.update();
        return "";
    },
    //拓扑线删除
    event_link_delete: function(links) {
        topo.delete_links(links);
        elem.update();
        return "";
    },
}

//拓扑初始化 
// TODO 添加主机/新节点在这里初始化
// 主机host 和 路由switch 一样是 node
// 拓扑关系 是 link
function initialize_topology() {
    //d3 目前版本api文档中已找不到json() 
    d3.json("/v1.0/topology/switches", function(error, switches) {
        d3.json("/v1.0/topology/links", function(error, links) {
            topo.initialize({ switches: switches, links: links });
            elem.update();
        });
    });
    //新增主机
    d3.json("", (err, hosts) => {
        d3.json("", (err, links) => {
            topo.initialize()
            elem.update()
        })
    })
}

function main() {
    initialize_topology();
}

main();