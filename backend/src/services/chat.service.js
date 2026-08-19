const { GoogleGenerativeAI } = require('@google/generative-ai');
const env = require('../config/env');
const logger = require('../utils/logger');
const { detectEmergency } = require('../utils/constants');

const SYSTEM_PROMPT = `You are the AI Mental Health First-Aid Assistant inside MindMitra, a platform designed for college students in India. You are supportive, warm, non-judgmental, and speak in clear, plain language.

CORE OPERATIONAL RULES:
1. BOUNDARIES:
   - You are NOT a licensed therapist or doctor.
   - NEVER provide clinical diagnoses or prescribe medication.
   - Encourage professional help whenever a student expresses distress.

2. RESPONSE FORMAT & VISUAL STRUCTURE (CRITICAL FOR STREAMING):
   - Each point must be on its own separate line.
   - Put a blank line between each point.
   - Use bold lead-ins at the start of each point for readability.
   - Keep responses concise: 3-4 short points maximum unless the student asks for more.
   - Avoid large paragraphs. Each idea should be one or two sentences max.
   - Example format:

**I hear you, and what you're feeling is valid.**

**You don't have to carry this alone.** There are people who want to support you through this.

**Taking a small step can help.** Try a slow breath, a short walk, or writing down what's on your mind.

**[Click Here to Book Appointment](https://mindmitra-lake.vercel.app/dashboard/student/appointments)**

3. COUNSELOR BOOKING TRIGGER (SERIOUS KEYWORDS):
   - Trigger Keywords/Topics: Persistent hopelessness, severe anxiety, academic burnout, emotional breakdown, trauma, grief, or inability to cope.
   - Action: Include a clean call-to-action button linking directly to the booking page. Use this exact markdown format on its own line:

     **[Click Here to Book Appointment](https://mindmitra-lake.vercel.app/dashboard/student/appointments)**

4. EMERGENCY & SELF-HARM PROTOCOL:
   - Trigger Keywords/Topics: Suicidal ideation, explicit intent, self-harm, or active crisis.
   - Action Steps:
     • Express immediate, grounded empathy.
     • Urge them to reach out immediately to a trusted person or a crisis helpline (Tele-MANAS: 1800-123-456 | AGRIM: 9335-665-318).
     • Inform them: "Our platform's emergency support protocol has been notified."
     • End with the appointment booking link:

       **[Click Here to Book Appointment](https://mindmitra-lake.vercel.app/dashboard/student/appointments)**

5. PROACTIVE COUNSELOR RECOMMENDATION:
   - After 3-4 conversation turns, if the student continues expressing distress, anxiety, overwhelm, sadness, or struggles (even without explicit emergency keywords), gently suggest they consider talking to a professional counselor.
   - Keep it warm and non-pushy. Example: "Based on what you've shared, I think talking to a professional counselor could really help. They're trained to support exactly what you're going through."
   - Include the appointment booking link after the suggestion.
   - Do NOT recommend booking in the very first message. Build rapport first.
   - Do NOT force the recommendation if the student seems to be doing better.`;

let genAI = null;
let model = null;

const getModel = () => {
  if (!env.geminiApiKey) return null;
  if (!genAI) {
    genAI = new GoogleGenerativeAI(env.geminiApiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash', systemInstruction: SYSTEM_PROMPT });
  }
  return model;
};

/**
 * Fallback used only if GEMINI_API_KEY is not configured, so the feature
 * still functions end-to-end (frontend contract never changes either way).
 */
const fallbackReply = (message) => {
  if (detectEmergency(message)) {
    return "I'm really concerned about what you just shared, and I'm glad you told me. You don't have to go through this alone right now — please reach out to someone you trust or a crisis helpline immediately. I've flagged this conversation so a counselor can follow up with you.";
  }
  return "Thanks for sharing that with me. I'm here to listen. Can you tell me a bit more about what's been going on and how long you've been feeling this way?";
};

/**
 * Sends a message (with prior conversation history) to Gemini and returns
 * the assistant's reply text. Falls back gracefully if the API key is
 * missing or the call fails, so the chat feature never hard-crashes.
 */
const getChatReply = async (message, history = []) => {
  const emergency = detectEmergency(message);
  const chatModel = getModel();

  if (!chatModel) {
    return { reply: fallbackReply(message), emergency };
  }

  try {
    const chat = chatModel.startChat({
      history: history.map((m) => ({
        role: m.role === 'ai' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const result = await chat.sendMessage(message);
    const candidate = result.response.candidates?.[0];
    const reply = result.response.text();

    if (candidate?.finishReason === 'MAX_TOKENS' && (!reply || reply.length < 20)) {
      logger.error('Gemini response truncated at MAX_TOKENS with near-empty output');
      return { reply: "I want to give you a complete answer rather than a cut-off one — could you ask that again, maybe a bit more specifically?", emergency };
    }

    return { reply, emergency };
  } catch (err) {
    logger.error('Gemini API call failed, using fallback', err.message);
    return { reply: fallbackReply(message), emergency };
  }
};



/**
 * Streams a reply from Gemini using sendMessageStream().
 * Yields { chunk } objects as they arrive, then returns the full accumulated reply.
 * On failure, yields the fallback reply as a single chunk.
 */
const getChatReplyStream = async function* (message, history = []) {
  const emergency = detectEmergency(message);
  const chatModel = getModel();

  if (!chatModel) {
    const fallback = fallbackReply(message);
    yield { chunk: fallback, done: true, emergency };
    return;
  }

  try {
    const chat = chatModel.startChat({
      history: history.map((m) => ({
        role: m.role === 'ai' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const streamResult = await chat.sendMessageStream(message);
    let fullReply = '';

    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        fullReply += text;
        yield { chunk: text, done: false, emergency };
      }
    }

    yield { chunk: '', done: true, emergency, fullReply };
  } catch (err) {
    logger.error('Gemini streaming failed, using fallback', err.message);
    const fallback = fallbackReply(message);
    yield { chunk: fallback, done: true, emergency };
  }
};

module.exports = { getChatReply, getChatReplyStream };
