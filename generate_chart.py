import sys
import json
import matplotlib.pyplot as plt
import datetime
import os
import numpy as np
import cloudinary
import cloudinary.uploader

# Setup
script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

def get_absolute_path(relative_path):
    return os.path.abspath(relative_path)

if len(sys.argv) < 3:
    print("Erro: Argumentos insuficientes! Use: python generate_chart.py input.json output.png")
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

if not os.path.exists(json_file_path):
    print(f"Erro: Arquivo JSON não encontrado: {json_file_path}")
    sys.exit(1)

try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
except json.JSONDecodeError as e:
    print(f"Erro: JSON inválido! {e}")
    sys.exit(1)

if not data:
    print("Erro: Nenhum dado encontrado no JSON!")
    sys.exit(1)

dias_semana = {
    "Mon": "seg", "Tue": "ter", "Wed": "qua", "Thu": "qui",
    "Fri": "sex", "Sat": "sáb", "Sun": "dom"
}

try:
    dates = [datetime.datetime.strptime(item["_id"], "%Y-%m-%d") for item in data]
    totals = [item["total"] for item in data]
    weekdays = [dias_semana[d.strftime("%a")] for d in dates]
    formatted_dates = [f"{dias_semana[d.strftime('%a')]} ({d.strftime('%d/%m')})" for d in dates]
except Exception as e:
    print(f"Erro ao processar os dados: {e}")
    sys.exit(1)

dias_da_semana_ordenados = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"]
totals_por_dia = {dia: 0 for dia in dias_da_semana_ordenados}
formatted_labels = {dia: "" for dia in dias_da_semana_ordenados}

for d, dia, total in zip(dates, weekdays, totals):
    totals_por_dia[dia] = total
    formatted_labels[dia] = f"{dia} ({d.strftime('%d/%m')})"

dias_plot = [formatted_labels[dia] if formatted_labels[dia] else dia for dia in dias_da_semana_ordenados]
totais_plot = list(totals_por_dia.values())

total_gastos = sum(totais_plot)

fig, ax = plt.subplots(figsize=(14, 6))
bars = ax.bar(dias_plot, totais_plot, color="#064e3b", alpha=0.8, width=0.6)

for bar, total in zip(bars, totais_plot):
    ax.text(
        bar.get_x() + bar.get_width() / 2,
        bar.get_height() + max(totais_plot) * 0.02,
        f"R$ {total:.2f}",
        ha="center", va="bottom", fontsize=10, fontweight="bold", color="#064e3b"
    )

ax.set_xlabel("")
ax.set_ylabel("")
ax.set_title("Gastos nos últimos dias", fontsize=14, fontweight="bold", loc="center", color="#064e3b")

ax.text(
    0.5, 1.05,
    f"Total: R$ {total_gastos:.2f}",
    fontsize=12, fontweight="bold", color="#064e3b", ha="center", transform=ax.transAxes
)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_visible(False)
ax.spines["bottom"].set_color("#064e3b")

ax.set_xticks(np.arange(len(dias_plot)))
ax.set_xticklabels(dias_plot, rotation=0, fontsize=12, color="#064e3b", ha="center")

plt.yticks([])
plt.tight_layout()

try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
except Exception as e:
    print(f"Erro ao salvar a imagem: {e}")
    sys.exit(1)

# ⬆️ Upload to Cloudinary
cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET")
)

try:
    result = cloudinary.uploader.upload(output_image_path, folder="whatsapp_reports")
    image_url = result.get("secure_url")
    if image_url:
        print(image_url)
        sys.exit(0)
    else:
        print("Erro: URL não retornada.")
        sys.exit(1)
except Exception as e:
    print(f"Erro ao enviar para Cloudinary: {e}")
    sys.exit(1)
