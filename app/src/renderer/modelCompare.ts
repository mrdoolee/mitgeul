import type { Provider } from '../core/schema';
import { chip, h, modal } from './dom';
import { MODEL_SAMPLES } from './modelSamples';

const PROVIDER_LABEL: Record<Provider, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude' };

/**
 * 모델 선택 안내: 같은 관찰 기록 하나(가상 학생)를 모델마다 보내 받은 AI 후보 5개를 보여 준다.
 * 저장된 시험 결과만 표시하며 요청을 새로 보내지 않는다.
 */
export function openModelCompare(current: Provider) {
  const S = MODEL_SAMPLES;
  const o = S.sample;
  const order: Provider[] = [current, ...(['gemini', 'openai', 'anthropic'] as Provider[]).filter((p) => p !== current)];
  return modal('AI 모델별 결과 비교', () =>
    h('div', { class: 'mcmp' },
      h('p', { class: 'muted' }, `같은 관찰 기록 하나를 모델마다 보내 받은 AI 후보 5개입니다(${S.at} 시험, 가상 학생). 요청할 때마다 문장은 조금씩 달라집니다.`),
      h('p', { class: 'hint' }, '모델마다 API로 직접 받은 결과입니다. 앱에서 Gemini는 API로 부르지만, ChatGPT(Codex CLI)에서는 OpenAI API 모델(gpt-5.4-mini 등)을 쓸 수 없고 Claude도 CLI 기본 지시가 더해져 문장이 다를 수 있습니다.'),
      h('div', { class: 'mcmp-input' },
        h('b', null, `보낸 관찰 기록 · ${o.area} · ${o.item} ${o.score}/5`),
        h('p', { class: 'mcmp-text' }, o.example),
      ),
      order.map((p) => {
        const rows = S.rows.filter((r) => r.provider === p);
        if (!rows.length) return null;
        return h('section', { class: 'mcmp-prov' },
          h('h3', null, PROVIDER_LABEL[p], p === current ? chip('지금 고른 제공자', 'ok') : null),
          h('div', { class: 'mcmp-grid' }, rows.map((r) =>
            h('article', { class: 'mcmp-card' },
              h('div', { class: 'mcmp-head' }, h('b', null, r.model), chip(r.role, r.role === '권장' ? 'ok' : '')),
              h('ol', { class: 'mcmp-list' }, r.texts.map((t) => h('li', null, t))),
            ),
          )),
        );
      }),
    ), true, { backdropClose: true, className: 'mcmp-modal' });
}
