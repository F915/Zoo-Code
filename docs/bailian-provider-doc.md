---
sidebar_label: Bailian (Alibaba Cloud)
description: Configure Alibaba Cloud Bailian (DashScope) models in Zoo Code. Access Qwen, DeepSeek, GLM, Kimi, MiniMax, and MiMo across multiple global regions with reasoning controls and prompt caching.
keywords:
  - bailian
  - alibaba cloud
  - dashscope
  - zoo code
  - api provider
  - qwen
  - deepseek
  - glm
  - kimi
  - minimax
  - reasoning
  - prompt caching
  - china ai
---

# Using Bailian (Alibaba Cloud) With Zoo Code

[Bailian](https://modelstudio.alibabacloud.com/) is Alibaba Cloud's AI model platform, providing access to a wide range of large language models through the DashScope API. The platform supports Qwen series, DeepSeek, GLM, Kimi, MiniMax, and MiMo models, with OpenAI-compatible endpoints across multiple global regions.

**Website:** [modelstudio.alibabacloud.com](https://modelstudio.alibabacloud.com/)

---

## Getting an API Key

Refer to the [Bailian API Key documentation](https://www.alibabacloud.com/help/en/model-studio/get-api-key) for instructions on obtaining your DashScope API key.

---

## Available Models

Zoo Code automatically fetches available models from the DashScope API based on your selected region. This ensures you always have access to the latest models, including newly released versioned model IDs.

The following preset models are included:

| Model | Context | Vision | Prompt Caching | Reasoning |
|-------|---------|--------|----------------|-----------|
| `qwen3.7-max` | 1,000,000 | No | Yes | Binary |
| `qwen3.7-plus` | 1,000,000 | Yes | Yes | Binary |
| `qwen3.6-plus` | 1,000,000 | Yes | Yes | Binary |
| `qwen3.6-flash` | 1,000,000 | Yes | Yes | Binary |
| `qwen3.5-plus` | 1,000,000 | Yes | Yes | Binary |
| `qwen3.5-flash` | 1,000,000 | Yes | Yes | Binary |
| `deepseek-v4-pro` | 1,000,000 | No | Yes | Effort-based |
| `deepseek-v4-flash` | 1,000,000 | No | Yes | Effort-based |
| `glm-5.1` | 202,752 | No | Yes | Binary |
| `kimi-k2.6` | 262,144 | No | Yes | Binary |
| `MiniMax-M2.5` | 196,608 | No | No | Always-on |
| `mimo-v2.5-pro` | 1,000,000 | No | No | Binary |

For the complete, up-to-date model list, see the [Bailian Model Documentation](https://www.alibabacloud.com/help/en/model-studio/models).

:::info
When using a custom model or an API-fetched model that isn't in the preset list, Zoo Code applies conservative defaults (200K context, no vision, no caching, temperature supported). You can override these by providing custom model info in the settings panel.
:::

---

## Configuration in Zoo Code

1. **Open Zoo Code Settings:** Click the gear icon (<Codicon name="gear" />) in the Zoo Code panel.
2. **Select Provider:** Choose "Bailian (Alibaba Cloud)" from the "API Provider" dropdown.
3. **Select Region:** Choose your preferred region. See [Available Regions](#available-regions) for details on endpoint locations.
4. **Enter API Key:** Paste your DashScope API key into the "Bailian API Key" field.
5. **(If Required) Enter Workspace ID:** For Frankfurt and Hong Kong regions, enter your workspace ID. Other regions can leave this blank.
6. **Select Model:** Choose your desired model from the "Model" dropdown. Available models are automatically fetched based on your region and API key.

### Reasoning Settings

For models that support reasoning (Qwen, DeepSeek V4, GLM, Kimi, MiMo), you can configure:

* **Reasoning Effort:** Toggle to enable or disable the thinking/reasoning phase. See [Reasoning Capabilities](#reasoning-capabilities) for model-specific behavior.
* **Reasoning Effort Level:** For DeepSeek V4, select Low/Medium/High (`high`) or X-High (`max`).
* **Max Thinking Tokens:** Set a budget cap for the thinking phase. When set, the model will not exceed this token limit during reasoning.

### Custom Model Configuration

If you're using a model that isn't auto-detected, or want to override the preset capabilities:

1. Check **Use custom model info** in settings.
2. Configure the context window, max output tokens, image support, and pricing manually.

---

## Available Regions

Bailian supports multiple regions worldwide. Select your preferred region in the Zoo Code settings panel — the API endpoint will be routed automatically.

| Region | Endpoint | Workspace ID |
|--------|----------|:------------:|
| Beijing | `dashscope.aliyuncs.com` | No |
| Singapore | `dashscope-intl.aliyuncs.com` | No |
| Virginia | `dashscope-us.aliyuncs.com` | No |
| Frankfurt | `<workspaceId>.eu-central-1.maas.aliyuncs.com` | **Yes** |
| Hong Kong | `<workspaceId>.cn-hongkong.maas.aliyuncs.com` | **Yes** |
| Coding Plan (CN) | `coding.dashscope.aliyuncs.com` | No |
| Token Plan (CN) | `token-plan.cn-beijing.maas.aliyuncs.com` | No |
| Token Plan (SG) | `token-plan.ap-southeast-1.maas.aliyuncs.com` | No |

Pricing varies by region. For the complete list of supported regions and guidance on choosing the right one, see the [Bailian Regions documentation](https://www.alibabacloud.com/help/en/model-studio/regions/) and [Bailian Pricing page](https://www.alibabacloud.com/help/en/model-studio/model-pricing).

---

## Reasoning Capabilities

Bailian models support three distinct reasoning modes. Zoo Code automatically detects the correct mode for your selected model.

### Binary Thinking (Qwen, GLM, Kimi, MiMo)

These models use `enable_thinking` to toggle an internal reasoning phase before generating the final response.

* Toggle **Reasoning Effort** on/off in the settings panel.
* Optionally set a **Max Thinking Tokens** budget to cap thinking phase token usage.
* Thinking is **enabled by default** for these models — the thinking phase improves answer quality for complex tasks.

### Effort-Based Reasoning (DeepSeek V4)

DeepSeek V4 supports graded reasoning depth via `reasoning_effort`:

| Zoo Code Setting | API Value | Behavior |
|-----------------|-----------|----------|
| Off | *(not sent)* | No thinking phase |
| Low / Medium / High | `high` | Standard reasoning depth |
| X-High | `max` | Maximum reasoning depth |

:::warning
When reasoning is explicitly disabled for DeepSeek V4, `enable_thinking: false` is sent to the API. This is required because DeepSeek V4 defaults to thinking ON — simply omitting the parameter would leave thinking enabled.
:::

### Always-On Thinking (MiniMax M2.5)

MiniMax M2.5 always performs a thinking phase and does not accept an `enable_thinking` toggle. The Reasoning Effort setting has no effect when using this model.

---

## Prompt Caching

Zoo Code automatically enables prompt caching for supported Bailian models (`qwen3.*`, `deepseek-v4-*`, `glm-5.1`, `kimi-k2.6`). Prompt caching reduces costs and latency by reusing previously processed content.

Cache markers are automatically applied to:

* The system prompt
* The last two user messages

:::info
Prompt caching requires no additional configuration — it is applied automatically whenever the selected model supports it.
:::

---

## Tips and Notes

* **Vision Models:** Models with vision support (`qwen3.7-plus`, `qwen3.6-plus`, `qwen3.6-flash`, `qwen3.5-plus`, `qwen3.5-flash`) can process images attached to your messages. Use the image upload feature in Zoo Code to include images in your prompts.
* **Context Window:** Most models support up to 1 million tokens of context. Note that the thinking phase also consumes context tokens — plan your prompts accordingly when reasoning is enabled.
* **Custom Models:** If the model you want isn't auto-detected, enable the custom model option and configure the context window and capabilities manually.
* **Region Selection:** Pricing varies by region. Choose a region based on your location and applicable local laws and regulations. Refer to the [Bailian Regions documentation](https://www.alibabacloud.com/help/en/model-studio/regions/) and [Bailian Pricing page](https://www.alibabacloud.com/help/en/model-studio/model-pricing) for details.
