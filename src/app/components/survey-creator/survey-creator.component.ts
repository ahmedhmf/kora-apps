import { Component, inject, signal, computed, Output, EventEmitter } from '@angular/core';
import { SurveySyncStore } from '../../store/survey-sync.store';
import { SurveyTemplate, SurveyField, SurveyFieldType } from '../../models/survey.model';

interface FieldCreatorItem {
  label: string;
  type: SurveyFieldType;
  options: string[]; // List of options item-by-item
  required: boolean;
}

@Component({
  selector: 'app-survey-creator',
  standalone: true,
  imports: [],
  template: `
    <div class="creator-canvas">
      <div class="creator-header">
        <h2 class="creator-title">⚙️ Design Custom Survey Template</h2>
        <p class="creator-desc">Create a completely custom survey layout on the fly. Fields are persisted locally offline so you can immediately begin evaluations during field visits.</p>
      </div>

      <form (submit)="$event.preventDefault(); saveTemplate()" class="creator-form">
        <!-- Survey Title & Meta -->
        <div class="meta-section">
          <div class="form-group required">
            <label for="survey_name" class="field-label">Survey Title / Name</label>
            <input 
              id="survey_name"
              type="text" 
              class="form-control"
              placeholder="e.g. Safety Compliance Audit, Daily Health Check"
              [value]="surveyName()"
              (input)="surveyName.set($any($event.target).value)"
              required
            />
          </div>

          <div class="form-group">
            <label for="survey_desc" class="field-label">Survey Description</label>
            <input 
              id="survey_desc"
              type="text" 
              class="form-control"
              placeholder="Describe the objective or audit target..."
              [value]="surveyDescription()"
              (input)="surveyDescription.set($any($event.target).value)"
            />
          </div>
        </div>

        <div class="divider-line"></div>

        <!-- Dynamic Questions Schema Builder -->
        <div class="questions-section">
          <div class="section-header-inline">
            <h3 class="section-subtitle">Survey Question Fields</h3>
            <button 
              type="button" 
              class="btn btn-add" 
              (click)="addField()"
            >
              ＋ Add Custom Question
            </button>
          </div>

          <div class="fields-builder-list">
            @for (field of fields(); track $index; let fieldIndex = $index) {
              <div class="field-builder-card">
                <div class="card-header-row">
                  <span class="field-number">Question #{{ $index + 1 }}</span>
                  <button 
                    type="button" 
                    class="btn-remove-field" 
                    (click)="removeField($index)"
                    title="Remove Question"
                  >
                    🗑️
                  </button>
                </div>
 
                <div class="builder-inputs-grid">
                  <!-- Label -->
                  <div class="form-group required">
                    <label class="field-label">Question Label / Title</label>
                    <input 
                      type="text"
                      class="form-control"
                      placeholder="e.g. Temperature, Health Status"
                      [value]="field.label"
                      (input)="updateField($index, { label: $any($event.target).value })"
                      required
                    />
                  </div>
 
                  <!-- Type -->
                  <div class="form-group required">
                    <label class="field-label">Response Type</label>
                    <select 
                      class="form-control form-select"
                      [value]="field.type"
                      (change)="updateField($index, { type: $any($event.target).value })"
                      required
                    >
                      <option value="text">Text Box (General writing)</option>
                      <option value="number">Number Box (Numerical values)</option>
                      <option value="dropdown">Dropdown Select (Predefined options)</option>
                      <option value="radio">Radio Buttons (Single choice option list)</option>
                      <option value="checkbox">Checkboxes (Multiple choices option list)</option>
                      <option value="star">Star Rating (1 to 5 Stars)</option>
                    </select>
                  </div>
 
                  <!-- Options List (Only for Select/Radio/Checkbox) -->
                  @if (field.type === 'dropdown' || field.type === 'radio' || field.type === 'checkbox') {
                    <div class="options-builder-container full-width">
                      <div class="options-builder-header">
                        <label class="field-label">Predefined Choices List</label>
                        <button 
                          type="button" 
                          class="btn-add-option-item" 
                          (click)="addOptionItem(fieldIndex)"
                        >
                          ＋ Add Choice
                        </button>
                      </div>
                      
                      <div class="option-items-list">
                        @for (opt of field.options; track optIndex; let optIndex = $index) {
                          <div class="option-item-row">
                            <input 
                              type="text"
                              class="form-control form-control-option"
                              placeholder="Choice #{{ optIndex + 1 }}"
                              [value]="opt"
                              (input)="updateOptionItem(fieldIndex, optIndex, $any($event.target).value)"
                              required
                            />
                            <button 
                              type="button" 
                              class="btn-remove-option-item"
                              (click)="removeOptionItem(fieldIndex, optIndex)"
                              [disabled]="field.options.length <= 1"
                              title="Delete Choice"
                            >
                              ✕
                            </button>
                          </div>
                        }
                      </div>
                    </div>
                  }

                  <!-- Required Switch -->
                  <div class="form-group-checkbox">
                    <label class="checkbox-container">
                      <input 
                        type="checkbox" 
                        [checked]="field.required"
                        (change)="updateField($index, { required: $any($event.target).checked })"
                      />
                      <span class="checkbox-label">Mandatory Question (Required for submission)</span>
                    </label>
                  </div>
                </div>
              </div>
            } @empty {
              <div class="fields-empty-state">
                <span>No questions added yet. Click "Add Custom Question" above to begin building the template.</span>
              </div>
            }
          </div>
        </div>

        <div class="divider-line"></div>

        <!-- Form Actions -->
        <div class="form-actions">
          <button 
            type="button" 
            class="btn btn-secondary" 
            (click)="cancelCreation()"
          >
            Cancel
          </button>
          <button 
            type="submit" 
            class="btn btn-primary" 
            [disabled]="!isValid()"
          >
            Save & Publish Template
          </button>
        </div>
      </form>
    </div>
  `,
  styles: `
    .creator-canvas {
      background: rgba(10, 10, 15, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 3rem 2.5rem;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
      min-height: 480px;
      display: flex;
      flex-direction: column;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .creator-header {
      margin-bottom: 2rem;
    }

    .creator-title {
      font-size: 1.8rem;
      font-weight: 700;
      background: linear-gradient(135deg, #ffffff 30%, #ffffff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 0 0.5rem 0;
      letter-spacing: -0.02em;
    }

    .creator-desc {
      font-size: 0.95rem;
      color: #8a8a93;
      margin: 0;
      line-height: 1.5;
    }

    .divider-line {
      height: 1px;
      background: rgba(255, 255, 255, 0.05);
      margin: 2rem 0;
    }

    .creator-form {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      flex-grow: 1;
    }

    .meta-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }

    @media (max-width: 768px) {
      .meta-section {
        grid-template-columns: 1fr;
        gap: 1.25rem;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .field-label {
      font-size: 0.85rem;
      font-weight: 700;
      color: #8a8a93;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .form-group.required .field-label::after {
      content: ' *';
      color: #ffffff;
      font-weight: bold;
    }

    .form-control {
      font-family: inherit;
      font-size: 1.1rem;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 0.85rem 1.25rem;
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

    .form-select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23dfb653'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 1.25rem center;
      background-size: 1.25rem;
      padding-right: 3rem;
      cursor: pointer;
    }

    .field-help {
      font-size: 0.775rem;
      color: #4a4a52;
      margin-top: 0.25rem;
    }

    .questions-section {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .section-header-inline {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .section-subtitle {
      font-size: 1.2rem;
      font-weight: 700;
      color: #ffffff;
      margin: 0;
      letter-spacing: -0.01em;
    }

    .fields-builder-list {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .field-builder-card {
      background: rgba(255, 255, 255, 0.01);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: 16px;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
      position: relative;
      transition: all 0.25s ease;

      &:hover {
        border-color: rgba(255, 255, 255, 0.25);
        background: rgba(255, 255, 255, 0.03);
      }
    }

    .card-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      padding-bottom: 0.75rem;
      margin-bottom: 0.25rem;
    }

    .field-number {
      font-size: 0.775rem;
      font-weight: 700;
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 0.25rem 0.75rem;
      border-radius: 99px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .btn-remove-field {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 1.25rem;
      opacity: 0.5;
      transition: all 0.2s ease;

      &:hover {
        opacity: 1;
        transform: scale(1.15);
        color: #f7768e;
      }
    }

    .builder-inputs-grid {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 1.25rem;

      .full-width {
        grid-column: span 2;
      }
    }

    @media (max-width: 768px) {
      .builder-inputs-grid {
        grid-template-columns: 1fr;
        
        .full-width {
          grid-column: span 1;
        }
      }
    }

    .form-group-checkbox {
      display: flex;
      align-items: center;
      padding-top: 0.5rem;
    }

    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
      font-size: 0.9rem;
      color: #8a8a93;
      user-select: none;

      input {
        cursor: pointer;
        width: 18px;
        height: 18px;
        accent-color: #ffffff;
      }
    }

    .checkbox-label {
      font-weight: 600;
    }

    .fields-empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: #4a4a52;
      font-size: 0.95rem;
      border: 1px dashed rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.005);
    }

    .form-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 1.5rem;
      padding-top: 1.5rem;
    }

    .btn {
      font-family: inherit;
      font-size: 1rem;
      font-weight: 700;
      padding: 0.85rem 1.75rem;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-add {
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 0.65rem 1.35rem;
      font-size: 0.85rem;
      font-weight: 700;
      border-radius: 10px;

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.45);
        transform: translateY(-1px);
      }
    }

    .btn-primary {
      background: #ffffff;
      color: #000000;
      box-shadow: 0 8px 20px rgba(255, 255, 255, 0.2);

      &:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 12px 28px rgba(255, 255, 255, 0.4);
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

    .btn-secondary {
      background: transparent;
      color: #8a8a93;
      border: 1px solid rgba(255, 255, 255, 0.06);

      &:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.03);
        border-color: rgba(255, 255, 255, 0.12);
      }
    }

    .options-builder-container {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      border: 1px dashed rgba(255, 255, 255, 0.15);
      padding: 1.5rem;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.01);
    }

    .options-builder-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      padding-bottom: 0.65rem;
      margin-bottom: 0.25rem;
    }

    .btn-add-option-item {
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.25);
      padding: 0.45rem 0.95rem;
      font-size: 0.775rem;
      font-weight: 700;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.45);
        transform: translateY(-1px);
      }
    }

    .option-items-list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
      }
    }

    .option-item-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .form-control-option {
      font-size: 0.95rem;
      padding: 0.65rem 1rem;
      flex-grow: 1;
    }

    .btn-remove-option-item {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.05);
      color: #8a8a93;
      font-size: 0.85rem;
      cursor: pointer;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.2s ease;

      &:hover:not(:disabled) {
        border-color: rgba(247, 118, 142, 0.3);
        color: #f7768e;
        background: rgba(247, 118, 142, 0.05);
      }

      &:disabled {
        opacity: 0.25;
        cursor: not-allowed;
      }
    }
  `
})
export class SurveyCreatorComponent {
  readonly store = inject(SurveySyncStore);

  @Output() readonly templateCreated = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();

  readonly surveyName = signal<string>('');
  readonly surveyDescription = signal<string>('');
  readonly fields = signal<FieldCreatorItem[]>([]);

  readonly isValid = computed(() => {
    const name = this.surveyName().trim();
    if (name.length === 0) return false;
    
    const items = this.fields();
    if (items.length === 0) return false;

    // Check if every field is valid
    for (const f of items) {
      if (f.label.trim().length === 0) return false;
      if (f.type === 'dropdown' || f.type === 'radio' || f.type === 'checkbox') {
        if (!f.options || f.options.length === 0) return false;
        if (f.options.some(opt => opt.trim().length === 0)) return false;
      }
    }

    return true;
  });

  addField() {
    this.fields.update(curr => [
      ...curr,
      { label: '', type: 'text', options: [], required: true }
    ]);
  }

  removeField(index: number) {
    this.fields.update(curr => curr.filter((_, i) => i !== index));
  }

  updateField(index: number, changes: Partial<FieldCreatorItem>) {
    this.fields.update(curr => curr.map((field, i) => {
      if (i === index) {
        const updated = { ...field, ...changes };
        if ((updated.type === 'dropdown' || updated.type === 'radio' || updated.type === 'checkbox') && (!updated.options || updated.options.length === 0)) {
          updated.options = ['Choice 1', 'Choice 2'];
        }
        return updated;
      }
      return field;
    }));
  }

  addOptionItem(fieldIndex: number) {
    this.fields.update(curr => curr.map((f, idx) => {
      if (idx === fieldIndex) {
        return {
          ...f,
          options: [...(f.options || []), '']
        };
      }
      return f;
    }));
  }

  removeOptionItem(fieldIndex: number, optionIndex: number) {
    this.fields.update(curr => curr.map((f, idx) => {
      if (idx === fieldIndex) {
        return {
          ...f,
          options: (f.options || []).filter((_, oIdx) => oIdx !== optionIndex)
        };
      }
      return f;
    }));
  }

  updateOptionItem(fieldIndex: number, optionIndex: number, newValue: string) {
    this.fields.update(curr => curr.map((f, idx) => {
      if (idx === fieldIndex) {
        return {
          ...f,
          options: (f.options || []).map((opt, oIdx) => oIdx === optionIndex ? newValue : opt)
        };
      }
      return f;
    }));
  }

  async saveTemplate() {
    if (!this.isValid()) return;

    const id = 'custom_' + Date.now();
    
    const keysSeen = new Set<string>();
    const compiledFields: SurveyField[] = this.fields().map((f, index) => {
      let baseKey = f.label.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .trim();

      if (!baseKey) {
        baseKey = `field_${index + 1}`;
      } else {
        baseKey = `${baseKey}_${index + 1}`;
      }

      let uniqueKey = baseKey;
      let counter = 1;
      while (keysSeen.has(uniqueKey)) {
        uniqueKey = `${baseKey}_${counter}`;
        counter++;
      }
      keysSeen.add(uniqueKey);

      return {
        key: uniqueKey,
        label: f.label.trim(),
        type: f.type,
        placeholder: (f.type === 'dropdown' || f.type === 'radio' || f.type === 'checkbox')
          ? 'Select option(s)' 
          : (f.type === 'star' ? 'Select star rating' : 'Enter response'),
        options: (f.type === 'dropdown' || f.type === 'radio' || f.type === 'checkbox')
          ? f.options.map(o => o.trim()).filter(o => o.length > 0)
          : undefined,
        required: f.required
      };
    });

    const newTemplate: SurveyTemplate = {
      id,
      name: this.surveyName().trim(),
      description: this.surveyDescription().trim(),
      fields: compiledFields
    };

    await this.store.createCustomTemplate(newTemplate);
    this.resetCreator();
    this.templateCreated.emit();
  }

  cancelCreation() {
    this.resetCreator();
    this.cancel.emit();
  }

  private resetCreator() {
    this.surveyName.set('');
    this.surveyDescription.set('');
    this.fields.set([]);
  }
}
