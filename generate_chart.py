import sys
import json
import matplotlib.pyplot as plt
import datetime
import os
import numpy as np
import cloudinary
import cloudinary.uploader

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

script_dir = os.path.dirname(os.path.abspath(__file__))
os.chdir(script_dir)

def get_absolute_path(relative_path):
    return os.path.abspath(relative_path)

if len(sys.argv) < 4:
    print("Erro: Argumentos insuficientes! Use: python generate_chart.py input.json output.png num_days", file=sys.stderr)
    sys.exit(1)

json_file_path = get_absolute_path(sys.argv[1])
output_image_path = get_absolute_path(sys.argv[2])

try:
    num_days = int(sys.argv[3])
    if num_days <= 0 or num_days > 7:
        print(f"Número de dias ({num_days}) inválido. O período deve ser entre 1 e 7 dias.", file=sys.stderr)
        sys.exit(1)
except ValueError:
    print("Erro: O número de dias deve ser um inteiro.", file=sys.stderr)
    sys.exit(1)

if not os.path.exists(json_file_path):
    print(f"Erro: Arquivo JSON não encontrado: {json_file_path}", file=sys.stderr)
    sys.exit(1)

try:
    with open(json_file_path, "r", encoding="utf-8") as file:
        data = json.load(file)
except json.JSONDecodeError as e:
    print(f"Erro: JSON inválido! {e}", file=sys.stderr)
    sys.exit(1)

dias_semana = {
    "Mon": "seg", "Tue": "ter", "Wed": "qua", "Thu": "qui",
    "Fri": "sex", "Sat": "sáb", "Sun": "dom"
}

try:
    hoje = datetime.date.today()
    ultimos_dias = [hoje - datetime.timedelta(days=i) for i in range(num_days - 1, -1, -1)]
    dates = [datetime.datetime.strptime(item["_id"], "%Y-%m-%d").date() for item in data]
    totals = [item["total"] for item in data]
    totals_por_dia = {data: 0 for data in ultimos_dias}
    for d, total in zip(dates, totals):
        if d in totals_por_dia:
            totals_por_dia[d] = total
    dias_plot = [f"{dias_semana[d.strftime('%a')]} ({d.strftime('%d/%m')})" for d in ultimos_dias]
    totais_plot = [totals_por_dia[d] for d in ultimos_dias]
except Exception as e:
    print(f"Erro ao processar os dados: {e}", file=sys.stderr)
    sys.exit(1)

total_gastos = sum(totais_plot)

vermelho_escuro = "#FF8C8C"
cor_texto = "black"
cor_borda = "black"

fig, ax = plt.subplots(figsize=(8, 12)) 

bars = ax.bar(dias_plot, totais_plot, color=vermelho_escuro, alpha=0.8, width=0.6, edgecolor=cor_borda, linewidth=1)

y_max_limit = max(totais_plot) * 1.15 if totais_plot and max(totais_plot) > 0 else 1
ax.set_ylim(0, y_max_limit)

for bar, total in zip(bars, totais_plot):
    ax.text(
        bar.get_x() + bar.get_width() / 2,
        bar.get_height() + y_max_limit * 0.01,
        f"R$ {total:.2f}",
        ha="center", va="bottom", fontsize=10, fontweight="bold", color=cor_texto
    )

ax.set_xlabel("")
ax.set_ylabel("")

title_text = f"Gastos nos últimos {num_days} dias" if num_days > 1 else "Gastos de hoje"
ax.set_title(title_text, fontsize=16, fontweight="bold", loc="center", color=cor_texto)

ax.text(
    0.5, 1.05,
    f"Total: R$ {total_gastos:.2f}",
    fontsize=14, fontweight="bold", color=cor_texto, ha="center", transform=ax.transAxes
)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_visible(False)
ax.spines["bottom"].set_color(cor_texto)

ax.set_xticks(np.arange(len(dias_plot)))
ax.set_xticklabels(dias_plot, rotation=45, fontsize=12, color=cor_texto, ha="right")

plt.yticks([])
plt.tight_layout()

try:
    plt.savefig(output_image_path, bbox_inches="tight", dpi=300)
except Exception as e:
    print(f"Erro ao salvar a imagem: {e}", file=sys.stderr)
    sys.exit(1)

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
        print("Erro: URL não retornada pelo Cloudinary.", file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f"Erro ao enviar para Cloudinary: {e}", file=sys.stderr)
    sys.exit(1)