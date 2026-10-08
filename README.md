# Protótipo de Eye Tracking Assistivo (Web / Chrome)

Sistema de comunicação alternativa e aumentativa (CAA) baseado no rastreamento do movimento da **íris** via webcam do MacBook, ideal para pacientes com restrição total de movimentos faciais e cefálicos.

---

## 🎯 Objetivos Implementados

1. **Enquadramento Facial**:
   - Espelho da câmera com máscara oval guia e rastreamento da malha facial em tempo real (MediaPipe Face Mesh).
   - Verificação de iluminação, abertura dos olhos e distância.
2. **Calibração em 5 Pontos**:
   - Sequência automática guiada com feedback sonoro e visual em 5 alvos estratégicos (Centro, Superior Esquerdo, Superior Direito, Inferior Esquerdo, Inferior Direito).
   - Regressão bilinear multivariada (Ridge) com rejeição de micro-sacadas iniciais.
3. **Tela de 4 Quadrantes com Dwell Time**:
   - 4 botões de alto contraste em tela cheia: **SIM**, **NÃO**, **ÁGUA**, **AJUDA**.
   - Temporizador de fixação (*Dwell Time*) com barra de progresso suave.
   - Feedback sonoro e **Síntese de Voz (TTS em Português)** que fala a opção escolhida.
   - Painel de controle para calibrar sensibilidade, tempo de fixação e filtro de estabilidade.

---

## 🚀 Como Executar no MacBook

### 1. Iniciar o Servidor Local
Abra o terminal na pasta do projeto e rode:

```bash
python3 -m http.server 8000
```

### 2. Abrir no Google Chrome
Acesse no Chrome:
```
http://localhost:8000
```
Permita o acesso à webcam quando o navegador solicitar.

### 3. Modo Tela Cheia (Recomendado)
Para melhor precisão e imersão:
* Pressione **F** ou `Cmd + Control + F` para entrar em tela cheia.

---

## ⌨️ Atalhos de Teclado Úteis

* **`C`**: Iniciar / Reiniciar a Calibração de 5 pontos a qualquer momento.
* **`F`**: Alternar Tela Cheia (Fullscreen).

---

## 💡 Dicas Clínicas para o Paciente

1. **Iluminação**: Mantenha a iluminação frontal suave e uniforme no rosto do paciente. Evite lâmpadas fortes atrás da cabeça.
2. **Distância**: O paciente deve estar a cerca de 45 a 65 cm da tela do MacBook, com a câmera nivelada na altura dos olhos.
3. **Cabeça Estável**: Como o paciente não movimenta a cabeça, o modelo se concentra exclusivamente na variação relativa da pupila/íris, garantindo máxima estabilidade.
