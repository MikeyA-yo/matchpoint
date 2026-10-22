"""Cluster-to-product ranking artefacts.

- `cluster_to_product.json` maps cluster ids to the recommended product id.
- `model.txt` is an optional LightGBM booster used by `infer.score_products`
  as a fallback when a customer has no persisted cluster assignment.
"""
