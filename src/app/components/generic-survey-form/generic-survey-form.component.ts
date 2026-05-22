import { Component, inject, signal, computed, effect, Output, EventEmitter } from '@angular/core';
import { SurveySyncStore } from '../../store/survey-sync.store';

@Component({
  selector: 'app-generic-survey-form',
  standalone: true,
  imports: [],
  template: `
    <div class="survey-wizard-container">
      @if (store.activeTemplate(); as template) {
        
        <!-- Wizard Progress Bar at the top of the card -->
        <div class="progress-bar-container">
          @let totalSteps = template.fields.length;
          @let activeStepIndex = currentStep();
          @let progressPercent = (activeStepIndex / totalSteps) * 100;
          
          <div class="progress-fill-line" [style.width.%]="progressPercent"></div>
          <div class="step-indicator-text">
            @if (currentStep() < template.fields.length) {
              Question {{ currentStep() + 1 }} of {{ template.fields.length }}
            } @else {
              Evaluation Completed
            }
          </div>
        </div>

        <div class="wizard-slide-canvas">

      <!-- Welcome Step: name, email, anonymous checkbox -->
          @if (showWelcome()) {
            <div class="wizard-slide welcome-slide">
              <div class="question-meta-badge">Before we begin</div>
              <h2 class="slide-question-label">Who is filling in this survey?</h2>

              <div class="welcome-form-zone">
                <!-- Anonymous toggle -->
                <div
                  class="anon-toggle-row"
                  [class.active]="isAnonymous()"
                  (click)="isAnonymous.update(v => !v)"
                >
                  <div class="checkbox-indicator-luxury">
                    @if (isAnonymous()) {
                      <span class="checkbox-checkmark">&#10003;</span>
                    }
                  </div>
                  <div class="anon-toggle-text">
                    <span class="anon-toggle-label">Submit anonymously</span>
                    <span class="anon-toggle-desc">Your name and email will not be stored.</span>
                  </div>
                </div>

                @if (!isAnonymous()) {
                  <div class="welcome-fields">
                    <div class="welcome-field-group">
                      <label class="welcome-label" for="respondent-name">Full Name <span class="required-star">*</span></label>
                      <input
                        id="respondent-name"
                        type="text"
                        class="form-control-luxury"
                        placeholder="Your full name"
                        [value]="respondentName()"
                        (input)="respondentName.set($any($event.target).value)"
                        (keydown.enter)="canStartSurvey() ? startSurvey() : null"
                        autocomplete="name"
                        autofocus
                      />
                    </div>
                    <div class="welcome-field-group">
                      <label class="welcome-label" for="respondent-email">Email Address <span class="required-star">*</span></label>
                      <input
                        id="respondent-email"
                        type="email"
                        class="form-control-luxury"
                        placeholder="your@email.com"
                        [value]="respondentEmail()"
                        (input)="respondentEmail.set($any($event.target).value)"
                        (keydown.enter)="canStartSurvey() ? startSurvey() : null"
                        autocomplete="email"
                      />
                    </div>
                  </div>

                  <p class="consent-note">
                    🔒 Your information is stored securely and used only for survey tracking purposes.
                  </p>
                }
              </div>

              <div class="slide-navigation">
                <div></div><!-- spacer -->
                <button
                  type="button"
                  class="btn-luxury-next"
                  [disabled]="!canStartSurvey()"
                  (click)="startSurvey()"
                >
                  Start Survey &rarr;
                </button>
              </div>
            </div>
          }

          <!-- Slide 0 to N-1: Dynamic Questions -->
          @if (!showWelcome() && currentStep() >= 0 && currentStep() < template.fields.length) {
            @let field = template.fields[currentStep()];
            <div class="wizard-slide question-slide">
              <div class="question-meta-badge">Question {{ currentStep() + 1 }}</div>
              <h2 class="slide-question-label">{{ field.label }}</h2>
              
              <div class="question-input-zone">
                @if (field.type === 'text') {
                  <input 
                    [id]="field.key"
                    type="text"
                    class="form-control-luxury"
                    [placeholder]="field.placeholder || 'Enter response'"
                    [value]="answers()[field.key] || ''"
                    (input)="updateAnswer(field.key, $any($event.target).value)"
                    (keydown.enter)="canProceed() ? nextStep() : null"
                    [required]="field.required ?? false"
                    autofocus
                  />
                }

                @if (field.type === 'number') {
                  <input 
                    [id]="field.key"
                    type="number"
                    class="form-control-luxury"
                    [placeholder]="field.placeholder || '0'"
                    [value]="answers()[field.key] || ''"
                    (input)="updateAnswer(field.key, $any($event.target).value)"
                    (keydown.enter)="canProceed() ? nextStep() : null"
                    [required]="field.required ?? false"
                    autofocus
                  />
                }

                @if (field.type === 'dropdown') {
                  <div class="luxury-select-container">
                    <select 
                      [id]="field.key"
                      class="form-control-luxury form-select-luxury"
                      [value]="answers()[field.key] || ''"
                      (change)="updateAnswer(field.key, $any($event.target).value)"
                      [required]="field.required ?? false"
                    >
                      <option value="" disabled selected>{{ field.placeholder || 'Select an option' }}</option>
                      @for (option of field.options || []; track option) {
                        <option [value]="option">{{ option }}</option>
                      }
                    </select>
                  </div>
                }

                @if (field.type === 'star') {
                  <div class="star-rating-luxury" [id]="field.key">
                    @for (star of [1, 2, 3, 4, 5]; track star) {
                      <button
                        type="button"
                        class="star-btn-luxury"
                        [class.active]="+(answers()[field.key] || 0) >= star"
                        (click)="updateAnswer(field.key, star.toString())"
                        [title]="star + ' Stars'"
                      >
                        ★
                      </button>
                    }
                    @if (answers()[field.key]) {
                      <div class="rating-value-luxury">{{ answers()[field.key] }} / 5 Stars</div>
                    }
                  </div>
                }

                @if (field.type === 'radio') {
                  <div class="luxury-options-list" [id]="field.key">
                    @for (option of field.options || []; track option) {
                      <div 
                        class="luxury-option-row" 
                        [class.active]="answers()[field.key] === option"
                        (click)="updateAnswer(field.key, option)"
                      >
                        <div class="radio-indicator-luxury">
                          <div class="radio-indicator-inner"></div>
                        </div>
                        <span class="option-text-luxury">{{ option }}</span>
                      </div>
                    }
                  </div>
                }

                @if (field.type === 'checkbox') {
                  <div class="luxury-options-list" [id]="field.key">
                    @for (option of field.options || []; track option) {
                      @let isChecked = isCheckboxSelected(field.key, option);
                      <div 
                        class="luxury-option-row" 
                        [class.active]="isChecked"
                        (click)="toggleCheckboxAnswer(field.key, option)"
                      >
                        <div class="checkbox-indicator-luxury">
                          @if (isChecked) {
                            <span class="checkbox-checkmark">✓</span>
                          }
                        </div>
                        <span class="option-text-luxury">{{ option }}</span>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Stepper Controls -->
              <div class="slide-navigation">
                <button 
                  type="button" 
                  class="btn-luxury-back"
                  [disabled]="currentStep() === 0"
                  (click)="prevStep()"
                >
                  ← Back
                </button>

                <button 
                  type="button" 
                  class="btn-luxury-next"
                  [disabled]="!canProceed()"
                  (click)="nextStep()"
                >
                  @if (currentStep() === template.fields.length - 1) {
                    Submit Evaluation ✓
                  } @else {
                    Next Question &rarr;
                  }
                </button>
              </div>
            </div>
          }

          <!-- Slide N: Thank You Page -->
          @if (!showWelcome() && currentStep() === template.fields.length) {
            <div class="wizard-slide thanks-slide">
              <div class="thanks-glow-ring">✓</div>
              <h2 class="slide-thanks-title">Thank you for your feedback!</h2>
              <p class="slide-subtitle">The response has been successfully recorded and queued for sync.</p>
              
              <div class="thanks-actions">
                <button 
                  type="button" 
                  class="btn-luxury-secondary"
                  (click)="restartSurvey()"
                >
                  New Survey
                </button>
                <button 
                  type="button" 
                  class="btn-luxury-primary"
                  (click)="finishSurvey()"
                >
                  Finish
                </button>
              </div>
            </div>
          }

        </div>

      } @else {
        <div class="empty-state-luxury">
          <div class="empty-icon">📋</div>
          <h3>No Active Survey Selected</h3>
          <p>Please select an evaluation template from the home panel to begin.</p>
        </div>
      }
    </div>
  `,
  styles: `
    .survey-wizard-container {
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 3rem 2rem;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      min-height: 520px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }

    // Progress Bar Styling
    .progress-bar-container {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: rgba(255, 255, 255, 0.03);
    }

    .progress-fill-line {
      height: 100%;
      background: linear-gradient(90deg, #ffffff, #ffffff, #ffffff); /* Luxurious Gold */
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.6);
      transition: width 0.4s ease;
    }

    .step-indicator-text {
      position: absolute;
      top: 12px;
      right: 20px;
      font-size: 0.775rem;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .wizard-slide-canvas {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 400px;
    }

    .wizard-slide {
      width: 100%;
      max-width: 680px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      animation: fadeIn 0.4s ease forwards;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .kiosk-brand-accent {
      font-size: 0.75rem;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      margin-bottom: 0.75rem;
    }

    .slide-title {
      font-size: 2.2rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 1rem 0;
      letter-spacing: -0.02em;
    }

    .slide-subtitle {
      font-size: 1rem;
      color: #8a8a93;
      margin: 0 0 2.5rem 0;
      line-height: 1.5;
    }

    .form-group-center {
      width: 100%;
      margin-bottom: 2.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .field-label-center {
      font-size: 0.85rem;
      font-weight: 700;
      color: #8a8a93;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }

    .form-control-luxury {
      width: 100%;
      max-width: 480px;
      font-family: inherit;
      font-size: 1.35rem;
      text-align: center;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1rem 1.5rem;
      outline: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

      &:focus {
        border-color: #ffffff;
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.04);
      }

      &::placeholder {
        color: #4a4a52;
      }
    }

    .form-select-luxury {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 1.25rem center;
      background-size: 1.25rem;
      padding-right: 3rem;
      cursor: pointer;
    }

    .luxury-select-container {
      width: 100%;
      display: flex;
      justify-content: center;
    }

    .luxury-options-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      width: 100%;
      max-width: 480px;
    }

    .luxury-option-row {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1.15rem 1.5rem;
      cursor: pointer;
      text-align: left;
      user-select: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover {
        border-color: rgba(255, 255, 255, 0.3);
        background: rgba(255, 255, 255, 0.04);
        transform: translateY(-2px);
      }

      &.active {
        border-color: #ffffff;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: 0 0 20px rgba(255, 255, 255, 0.1);
      }
    }

    .radio-indicator-luxury {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.25s ease;

      .luxury-option-row.active & {
        border-color: #ffffff;
      }
    }

    .radio-indicator-inner {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: transparent;
      transition: all 0.25s ease;

      .luxury-option-row.active & {
        background: #ffffff;
        box-shadow: 0 0 8px #ffffff;
      }
    }

    .checkbox-indicator-luxury {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.25s ease;

      .luxury-option-row.active & {
        border-color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .checkbox-checkmark {
      font-size: 0.9rem;
      font-weight: bold;
      color: #ffffff;
      text-shadow: 0 0 5px rgba(255, 255, 255, 0.5);
    }

    .option-text-luxury {
      font-size: 1.15rem;
      font-weight: 500;
      color: #ffffff;
      transition: all 0.25s ease;

      .luxury-option-row.active & {
        color: #ffffff;
      }
    }

    // Single Question Layout
    .question-meta-badge {
      font-size: 0.775rem;
      font-weight: 700;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 0.25rem 0.75rem;
      border-radius: 99px;
      margin-bottom: 1.25rem;
      letter-spacing: 0.05em;
    }

    .slide-question-label {
      font-size: 2rem;
      font-weight: 600;
      color: #ffffff;
      margin: 0 0 2.5rem 0;
      line-height: 1.3;
      max-width: 600px;
    }

    .question-input-zone {
      width: 100%;
      margin-bottom: 3.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    // Star rating styles
    .star-rating-luxury {
      display: flex;
      flex-direction: row;
      gap: 0.85rem;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
    }

    .star-btn-luxury {
      background: transparent;
      border: none;
      font-size: 3rem;
      color: #1e1e24;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      -webkit-tap-highlight-color: transparent;

      &:hover {
        transform: scale(1.2);
        color: #ffffff;
      }

      &.active {
        color: #ffffff;
        text-shadow: 0 0 15px rgba(255, 255, 255, 0.5);
      }
    }

    .rating-value-luxury {
      width: 100%;
      font-size: 0.9rem;
      font-weight: 700;
      color: #ffffff;
      margin-top: 1.25rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    // Navigation footers
    .slide-navigation {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      width: 100%;
      max-width: 480px;
      justify-content: space-between;
    }

    .btn-luxury-primary {
      font-family: inherit;
      font-size: 1.05rem;
      font-weight: 700;
      color: #000000;
      background: #ffffff; /* Pure Luxury Gold */
      border: none;
      padding: 0.95rem 2rem;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(255, 255, 255, 0.25);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px rgba(255, 255, 255, 0.45);
      }

      &:active:not(:disabled) {
        transform: translateY(0);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        box-shadow: none;
      }
    }

    .btn-luxury-secondary {
      font-family: inherit;
      font-size: 1.05rem;
      font-weight: 700;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 0.95rem 2rem;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.45);
        transform: translateY(-2px);
      }
    }

    .btn-luxury-next {
      flex-grow: 1;
      font-family: inherit;
      font-size: 1rem;
      font-weight: 700;
      color: #000000;
      background: #ffffff;
      border: none;
      padding: 0.9rem 1.75rem;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 8px 20px rgba(255, 255, 255, 0.2);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(255, 255, 255, 0.4);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
        box-shadow: none;
      }
    }

    .btn-luxury-back {
      font-family: inherit;
      font-size: 1rem;
      font-weight: 700;
      color: #8a8a93;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 0.9rem 1.5rem;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.03);
        border-color: rgba(255, 255, 255, 0.12);
      }
    }

    .slide-actions-center {
      width: 100%;
      display: flex;
      justify-content: center;
    }

    // Thank You slide
    .thanks-slide {
      animation: zoomIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    @keyframes zoomIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .thanks-glow-ring {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.08);
      border: 2px solid #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      color: #ffffff;
      margin-bottom: 2rem;
      box-shadow: 0 0 25px rgba(255, 255, 255, 0.25);
    }

    .slide-thanks-title {
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #ffffff 30%, #ffffff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 0 1rem 0;
      letter-spacing: -0.02em;
    }

    .thanks-actions {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      width: 100%;
      max-width: 440px;
      justify-content: center;
    }

    .empty-state-luxury {
      text-align: center;
      color: #4a4a52;

      .empty-icon {
        font-size: 4rem;
        margin-bottom: 1.5rem;
      }

      h3 {
        color: #ffffff;
        font-size: 1.5rem;
        margin: 0 0 0.5rem 0;
      }
    }

    // Welcome screen styles
    .welcome-slide {
      max-width: 560px;
      margin: 0 auto;
    }

    .welcome-form-zone {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      margin-bottom: 2rem;
    }

    .anon-toggle-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
      background: rgba(255, 255, 255, 0.02);

      &:hover {
        border-color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.04);
      }

      &.active {
        border-color: rgba(255, 255, 255, 0.4);
        background: rgba(255, 255, 255, 0.06);
      }

      .anon-toggle-text {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;

        .anon-toggle-label {
          font-size: 0.95rem;
          font-weight: 600;
          color: #ffffff;
        }

        .anon-toggle-desc {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.45);
        }
      }
    }

    .welcome-fields {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .welcome-field-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      .welcome-label {
        font-size: 0.8rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.55);
        text-transform: uppercase;
        letter-spacing: 0.06em;

        .required-star {
          color: #f7768e;
          margin-left: 2px;
        }
      }
    }

    .consent-note {
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.35);
      margin: 0;
      text-align: center;
      line-height: 1.5;
    }
  `
})
export class GenericSurveyFormComponent {
  readonly store = inject(SurveySyncStore);

  @Output() readonly finished = new EventEmitter<void>();

  // Welcome screen state
  readonly showWelcome = signal<boolean>(true);
  readonly respondentName = signal<string>('');
  readonly respondentEmail = signal<string>('');
  readonly isAnonymous = signal<boolean>(false);

  readonly clientIdentifier = signal<string>('');
  readonly answers = signal<{ [key: string]: string }>({});

  // Wizard runner state:
  // Step 0 to N-1: Dynamic Survey Questions
  // Step N: Thank You Page
  readonly currentStep = signal<number>(0);

  readonly canProceed = computed(() => {
    const step = this.currentStep();
    const template = this.store.activeTemplate();
    if (!template) return false;

    if (step >= 0 && step < template.fields.length) {
      const field = template.fields[step];
      if (!field.required) return true;
      const val = this.answers()[field.key];
      return val !== undefined && val.trim().length > 0;
    }

    return true;
  });

  readonly canStartSurvey = computed(() => {
    if (this.isAnonymous()) return true;
    const name = this.respondentName().trim();
    const email = this.respondentEmail().trim();
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    return name.length > 0 && emailValid;
  });

  constructor() {
    // Reset when active template changes
    effect(() => {
      const _ = this.store.activeTemplate();
      this.resetForm();
    }, { allowSignalWrites: true });
  }

  nextStep() {
    if (!this.canProceed()) return;

    const template = this.store.activeTemplate();
    if (!template) return;

    if (this.currentStep() === template.fields.length - 1) {
      // On final question, submit survey and go to Thank You slide
      this.submitSurvey();
    } else {
      this.currentStep.update(s => s + 1);
    }
  }

  prevStep() {
    if (this.currentStep() > 0) {
      this.currentStep.update(s => s - 1);
    }
  }


  updateAnswer(key: string, value: string) {
    this.answers.update(curr => ({ ...curr, [key]: value }));
  }

  isCheckboxSelected(key: string, option: string): boolean {
    const val = this.answers()[key] || '';
    const parts = val.split(',').map(s => s.trim());
    return parts.includes(option);
  }

  toggleCheckboxAnswer(key: string, option: string) {
    const val = this.answers()[key] || '';
    let parts = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (parts.includes(option)) {
      parts = parts.filter(p => p !== option);
    } else {
      parts.push(option);
    }
    parts.sort();
    this.updateAnswer(key, parts.join(', '));
  }

  startSurvey() {
    if (!this.canStartSurvey()) return;
    this.showWelcome.set(false);
    this.clientIdentifier.set(
      this.isAnonymous() ? 'Anonymous' : this.respondentName().trim()
    );
  }

  async submitSurvey() {
    const template = this.store.activeTemplate();
    if (!template) return;

    const payload = {
      template_id: template.id,
      client_identifier: this.clientIdentifier().trim(),
      respondent_name: this.isAnonymous() ? null : (this.respondentName().trim() || null),
      respondent_email: this.isAnonymous() ? null : (this.respondentEmail().trim() || null),
      is_anonymous: this.isAnonymous(),
      answers: this.answers()
    };

    await this.store.saveGenericSubmission(payload);
    // Proceed to Thank You Slide
    this.currentStep.set(template.fields.length);
  }

  restartSurvey() {
    this.resetForm();
  }

  finishSurvey() {
    this.resetForm();
    this.finished.emit();
  }

  resetForm() {
    this.showWelcome.set(true);
    this.respondentName.set('');
    this.respondentEmail.set('');
    this.isAnonymous.set(false);
    this.clientIdentifier.set('');
    this.answers.set({});
    this.currentStep.set(0);
  }
}
