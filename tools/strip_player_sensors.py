import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    data = json.load(f)

root = next(o for o in data if o.get("__type__") == "cc.Node" and o.get("__id__") == 1)
root["_children"] = [c for c in root["_children"] if c["__id__"] not in (32, 44)]

start_back = next(
    i
    for i, o in enumerate(data)
    if o.get("__type__") == "cc.Node" and o.get("_name") == "BackSensor"
)
start_front = next(
    i
    for i, o in enumerate(data)
    if o.get("__type__") == "cc.Node" and o.get("_name") == "FrontSensor"
)
end_front = None
for j in range(start_front + 1, len(data)):
    o = data[j]
    if o.get("__type__") == "cc.UITransform" and o.get("node", {}).get("__id__") == 1:
        end_front = j - 1
        break
if end_front is None:
    sys.exit("end_front not found")

remove_idx = set(range(start_back, end_front + 1))
new_data = [o for i, o in enumerate(data) if i not in remove_idx]

for o in new_data:
    if o.get("__type__") == "8c3a49tjzhOg5/VDbmw9KPh":
        o.pop("useBodyColliderProbe", None)
        o.pop("frontSensor", None)
        o.pop("backSensor", None)
        if "bodyProbeCollider" in o:
            o["pathCollider"] = o.pop("bodyProbeCollider")
        if "pathProbeDeadZonePx" in o:
            o["pathSideDeadZonePx"] = o.pop("pathProbeDeadZonePx")

with open(path, "w", encoding="utf-8", newline="\n") as f:
    json.dump(new_data, f, ensure_ascii=False, indent=2)
    f.write("\n")

print("ok", len(data), "->", len(new_data), "removed", len(remove_idx))
