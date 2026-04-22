"""
Generate a sample success JSON response for the Water Engine with validation layer.
"""
import json

from water_engine import AuditContext, WaterDischarge, WaterEngine, WaterInput, WaterWithdrawal

# Reference case from requirements
water_input = WaterInput(
    withdrawal=WaterWithdrawal(
        surface_water=500_000,
        municipal_potable_water=50_000,
    ),
    discharge=WaterDischarge(
        surface_water=100_000,
    ),
    cementitious_production_t_yr=2_300_000,
)

audit_context = AuditContext(
    source_filename="sample_water_input.json",
    upload_timestamp_utc="2026-04-22T10:30:00Z",
    user_id="demo_user",
)

engine = WaterEngine(water_input, audit_context)
result = engine.calculate()

# Serialize to JSON
output = result.model_dump()

print(json.dumps(output, indent=2))

# Write to file
with open("water_engine/sample_output.json", "w") as f:
    json.dump(output, f, indent=2)

print("\n✅ Sample output written to water_engine/sample_output.json")
