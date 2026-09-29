"""Builds the Lakeview dashboard JSON for one live project's per-project dashboard.

Usage: python3 build_dashboard_config.py BM-L-001 > project_progress_bm_l_001.lvdash.json

Supersedes the single shared, `project_id`-filtered dashboard built in
Phase 5. That design turned out to be incompatible with using a dashboard's
*native* "Ask Genie" button in a per-project-correct way: Lakeview's
`uiSettings.genieSpace.overrideId` is one static space ID baked into the
dashboard *object*, which can never track an interactive filter's current
value. Rather than bolt on a second, separate Genie chat surface inside the
app (tried in Phase 8a, reverted — it felt like two competing "Ask Genie"
entry points), this instead mints one dashboard PER project, each hardcoded
to that project's own `project_id` (no interactive project filter needed —
mirrors the static per-project Genie views from Phase 7) and natively linked
via `overrideId` to that project's already-existing curated Genie agent. One
integrated surface per project: the dashboard's own built-in Genie button,
correctly scoped, no second tab.

Genie space IDs are the same 5 stable ids created in Phase 7
(resources/genie_spaces/*.genie-space.yml) — hardcoded here for the same
reason `DASHBOARD_ID` was already a hardcoded literal in app.yaml: a
dashboard's `file_path`-loaded JSON is opaque to bundle variable
substitution (`${resources...}` only resolves inside the `.yml` files
themselves), so there's no way to reference `resources.genie_spaces.*.id`
from inside this file's content.
"""
import json
import sys

PROJECTS = {
    "BM-L-001": {
        "name": "Petrochemical Unit - Unit 300",
        "genie_space_id": "01f1bc14c9b21cc29434ac66028bdcee",
    },
    "BM-L-002": {
        "name": "Refinery Expansion - Pipe Rack B",
        "genie_space_id": "01f1bc158e961f96acfcd4ba8a7d2dcf",
    },
    "BM-L-003": {
        "name": "Power Plant Piping - Pipe Rack A",
        "genie_space_id": "01f1bc15900017ee926e02c5dab6d79b",
    },
    "BM-L-004": {
        "name": "Refinery Expansion - Pipe Rack A",
        "genie_space_id": "01f1bc1591661a4ba77ffe25eceabc18",
    },
    "BM-L-005": {
        "name": "Gas Processing Plant - Pipe Rack A",
        "genie_space_id": "01f1bc1592d21eb49a1647534d5962ed",
    },
}


def build(project_id: str) -> dict:
    info = PROJECTS[project_id]

    return {
        "datasets": [
            {
                "name": "ds_rollup",
                "displayName": "Project Rollup",
                "queryLines": [
                    "SELECT project_id, project_name, client_name, total_lines, lines_complete, ",
                    "       pct_lines_complete, mode_stage, min_stage, avg_days_in_current_stage ",
                    "FROM gold_project_rollup ",
                    f"WHERE data_origin = 'LIVE' AND project_id = '{project_id}' ",
                ],
            },
            {
                "name": "ds_lines",
                "displayName": "Line Status",
                "queryLines": [
                    "SELECT project_id, line_no, service, line_class_spec, nominal_size_in, material, ",
                    "       current_stage, current_stage_name, is_complete, ",
                    "       CASE WHEN is_complete THEN 'Complete' ELSE 'In Progress' END AS completion_status, ",
                    "       latest_event_actor_role, latest_event_timestamp, ",
                    "       prelim_length_variance_pct, final_length_variance_pct ",
                    "FROM gold_line_status ",
                    f"WHERE data_origin = 'LIVE' AND project_id = '{project_id}' ",
                ],
            },
        ],
        "pages": [
            {
                "name": "main",
                "displayName": "Project Progress",
                "pageType": "PAGE_TYPE_CANVAS",
                "layoutVersion": "GRID_V1",
                "layout": [
                    {
                        "widget": {
                            "name": "title",
                            "multilineTextboxSpec": {
                                "lines": [f"## Piping Project Progress — {project_id}\n"]
                            },
                        },
                        "position": {"x": 0, "y": 0, "width": 12, "height": 1},
                    },
                    {
                        "widget": {
                            "name": "subtitle",
                            "multilineTextboxSpec": {
                                "lines": [
                                    f"{info['name']} ({project_id}). Progress through the 6-stage ",
                                    "estimate -> confirm -> true-up workflow. Data refreshes from Lakebase via CDC. ",
                                    "Use **Ask Genie** below for questions beyond this view — it's scoped to this project.",
                                ]
                            },
                        },
                        "position": {"x": 0, "y": 1, "width": 12, "height": 2},
                    },
                    {
                        "widget": {
                            "name": "kpi_total_lines",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_rollup",
                                        "fields": [{"name": "total_lines", "expression": "`total_lines`"}],
                                        "disaggregated": True,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 2,
                                "widgetType": "counter",
                                "encodings": {
                                    "value": {
                                        "fieldName": "total_lines",
                                        "displayName": "Total Lines",
                                        "format": {"type": "number"},
                                    }
                                },
                                "frame": {"showTitle": True, "title": "Total Lines"},
                            },
                        },
                        "position": {"x": 0, "y": 3, "width": 3, "height": 3},
                    },
                    {
                        "widget": {
                            "name": "kpi_pct_complete",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_rollup",
                                        "fields": [
                                            {"name": "pct_lines_complete", "expression": "`pct_lines_complete`"}
                                        ],
                                        "disaggregated": True,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 2,
                                "widgetType": "counter",
                                "encodings": {
                                    "value": {
                                        "fieldName": "pct_lines_complete",
                                        "displayName": "% Complete",
                                        "format": {
                                            "type": "number-percent",
                                            "decimalPlaces": {"type": "max", "places": 1},
                                        },
                                    }
                                },
                                "frame": {"showTitle": True, "title": "Lines Complete"},
                            },
                        },
                        "position": {"x": 3, "y": 3, "width": 3, "height": 3},
                    },
                    {
                        "widget": {
                            "name": "kpi_avg_days",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_rollup",
                                        "fields": [
                                            {
                                                "name": "avg_days_in_current_stage",
                                                "expression": "`avg_days_in_current_stage`",
                                            }
                                        ],
                                        "disaggregated": True,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 2,
                                "widgetType": "counter",
                                "encodings": {
                                    "value": {
                                        "fieldName": "avg_days_in_current_stage",
                                        "displayName": "Avg Days in Current Stage",
                                        "format": {
                                            "type": "number-plain",
                                            "decimalPlaces": {"type": "max", "places": 1},
                                        },
                                        "formatTemplate": "{{@formatted}} days",
                                    }
                                },
                                "frame": {
                                    "showTitle": True,
                                    "title": "Avg Days in Current Stage",
                                    "showDescription": True,
                                    "description": "Among lines not yet complete",
                                },
                            },
                        },
                        "position": {"x": 6, "y": 3, "width": 3, "height": 3},
                    },
                    {
                        "widget": {
                            "name": "kpi_avg_variance",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_lines",
                                        "fields": [
                                            {
                                                "name": "avg(prelim_length_variance_pct)",
                                                "expression": "AVG(`prelim_length_variance_pct`)",
                                            }
                                        ],
                                        "disaggregated": False,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 2,
                                "widgetType": "counter",
                                "encodings": {
                                    "value": {
                                        "fieldName": "avg(prelim_length_variance_pct)",
                                        "displayName": "Avg Prelim Length Variance",
                                        "format": {
                                            "type": "number-plain",
                                            "decimalPlaces": {"type": "max", "places": 1},
                                        },
                                        "formatTemplate": "{{@formatted}}%",
                                    }
                                },
                                "frame": {
                                    "showTitle": True,
                                    "title": "Avg Prelim Length Variance",
                                    "showDescription": True,
                                    "description": "Actual vs. estimated centerline length",
                                },
                            },
                        },
                        "position": {"x": 9, "y": 3, "width": 3, "height": 3},
                    },
                    {
                        "widget": {
                            "name": "header_breakdown",
                            "multilineTextboxSpec": {"lines": ["### Where the lines are\n"]},
                        },
                        "position": {"x": 0, "y": 6, "width": 12, "height": 1},
                    },
                    {
                        "widget": {
                            "name": "bar_stage",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_lines",
                                        "fields": [
                                            {"name": "current_stage_name", "expression": "`current_stage_name`"},
                                            {"name": "current_stage", "expression": "`current_stage`"},
                                            {"name": "count(*)", "expression": "COUNT(*)"},
                                        ],
                                        "disaggregated": False,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 3,
                                "widgetType": "bar",
                                "encodings": {
                                    "x": {
                                        "fieldName": "current_stage_name",
                                        "displayName": "Stage",
                                        "scale": {
                                            "type": "categorical",
                                            "sort": {
                                                "by": "custom-order",
                                                "orderedValues": [
                                                    "Initial Data Entry",
                                                    "Initial Engineer Confirmation",
                                                    "Preliminary True-Up Complete",
                                                    "Engineer Prelim True-Up Confirmation",
                                                    "Final True-Up Complete",
                                                    "Engineer Final Confirmation",
                                                ],
                                            },
                                        },
                                    },
                                    "y": {
                                        "fieldName": "count(*)",
                                        "displayName": "Lines",
                                        "scale": {"type": "quantitative"},
                                    },
                                },
                                "frame": {"showTitle": True, "title": "Lines by Stage"},
                            },
                        },
                        "position": {"x": 0, "y": 7, "width": 6, "height": 5},
                    },
                    {
                        "widget": {
                            "name": "pie_completion",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_lines",
                                        "fields": [
                                            {"name": "completion_status", "expression": "`completion_status`"},
                                            {"name": "count(*)", "expression": "COUNT(*)"},
                                        ],
                                        "disaggregated": False,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 3,
                                "widgetType": "pie",
                                "encodings": {
                                    "angle": {
                                        "fieldName": "count(*)",
                                        "displayName": "Lines",
                                        "scale": {"type": "quantitative"},
                                    },
                                    "color": {
                                        "fieldName": "completion_status",
                                        "displayName": "Status",
                                        "scale": {
                                            "type": "categorical",
                                            "mappings": [
                                                {"value": "Complete", "color": "#009E73"},
                                                {"value": "In Progress", "color": "#E69F00"},
                                            ],
                                        },
                                    },
                                    "label": {"show": True},
                                },
                                "frame": {"showTitle": True, "title": "Complete vs. In Progress"},
                            },
                        },
                        "position": {"x": 6, "y": 7, "width": 6, "height": 5},
                    },
                    {
                        "widget": {
                            "name": "header_detail",
                            "multilineTextboxSpec": {"lines": ["### Line detail\n"]},
                        },
                        "position": {"x": 0, "y": 12, "width": 12, "height": 1},
                    },
                    {
                        "widget": {
                            "name": "table_lines",
                            "queries": [
                                {
                                    "name": "main_query",
                                    "query": {
                                        "datasetName": "ds_lines",
                                        "fields": [
                                            {"name": "line_no", "expression": "`line_no`"},
                                            {"name": "service", "expression": "`service`"},
                                            {"name": "line_class_spec", "expression": "`line_class_spec`"},
                                            {"name": "current_stage_name", "expression": "`current_stage_name`"},
                                            {
                                                "name": "latest_event_actor_role",
                                                "expression": "`latest_event_actor_role`",
                                            },
                                            {
                                                "name": "prelim_length_variance_pct",
                                                "expression": "`prelim_length_variance_pct`",
                                            },
                                            {
                                                "name": "final_length_variance_pct",
                                                "expression": "`final_length_variance_pct`",
                                            },
                                        ],
                                        "disaggregated": True,
                                    },
                                }
                            ],
                            "spec": {
                                "version": 2,
                                "widgetType": "table",
                                "encodings": {
                                    "columns": [
                                        {"fieldName": "line_no", "displayName": "Line No."},
                                        {"fieldName": "service", "displayName": "Service"},
                                        {"fieldName": "line_class_spec", "displayName": "Class / Spec"},
                                        {"fieldName": "current_stage_name", "displayName": "Current Stage"},
                                        {"fieldName": "latest_event_actor_role", "displayName": "Last Action By"},
                                        {
                                            "fieldName": "prelim_length_variance_pct",
                                            "displayName": "Prelim Variance",
                                            "format": {
                                                "type": "number-plain",
                                                "decimalPlaces": {"type": "max", "places": 1},
                                                "suffix": "%",
                                            },
                                        },
                                        {
                                            "fieldName": "final_length_variance_pct",
                                            "displayName": "Final Variance",
                                            "format": {
                                                "type": "number-plain",
                                                "decimalPlaces": {"type": "max", "places": 1},
                                                "suffix": "%",
                                            },
                                        },
                                    ]
                                },
                                "frame": {"showTitle": True, "title": "Line Detail"},
                            },
                        },
                        "position": {"x": 0, "y": 13, "width": 12, "height": 6},
                    },
                ],
            }
        ],
        "uiSettings": {
            "theme": {
                "canvasBackgroundColor": {"light": "#FCFCFC", "dark": "#1F272D"},
                "widgetBackgroundColor": {"light": "#FFFFFF", "dark": "#11171C"},
                "widgetBorderColor": {"light": "#FFFFFF", "dark": "#11171C"},
                "fontColor": {"light": "#11171C", "dark": "#E8ECF0"},
                "selectionColor": {"light": "#2272B4", "dark": "#8ACAFF"},
                "visualizationColors": [
                    "#0072B2",
                    "#E69F00",
                    "#009E73",
                    "#CC79A7",
                    "#D55E00",
                    "#56B4E9",
                    "#F0E442",
                ],
                "widgetHeaderAlignment": "LEFT",
            },
            "genieSpace": {
                "isEnabled": True,
                "overrideId": info["genie_space_id"],
                "enablementMode": "ENABLED",
            },
        },
    }


if __name__ == "__main__":
    project_id = sys.argv[1]
    print(json.dumps(build(project_id), indent=2))
