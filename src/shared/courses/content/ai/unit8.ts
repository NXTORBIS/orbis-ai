import type { Module } from '../../types.ts'

/**
 * Unit 08 — Computer vision.
 *
 * Images as data, convolution built from a kernel sliding over a grid, then the three vision tasks kept clearly
 * apart — classification, detection and segmentation are different jobs with different labels and different
 * metrics, and conflating them is the commonest confusion in applied vision work.
 *
 * Image processing is placed last rather than first. It is genuinely useful, and putting it first makes people
 * think convolution is a kind of filter they already know, which obscures the fact that a network learns its
 * kernels rather than being given them.
 */
export const AI_UNIT_8: Module = {
  id: 'u8',
  title: 'Computer Vision',
  summary:
    'Pixels, channels and tensors; convolution, feature maps and pooling; the three vision tasks and their metrics; augmentation; and classical image processing, which still does half the work.',
  concepts: ['image-data', 'convolution', 'feature-maps', 'cnn', 'image-tasks', 'augmentation', 'image-processing'],
  lessons: [
    // ------------------------------------------------------------------ 1
    {
      id: 'u8l1',
      title: 'Images as data',
      intro:
        'Before any network: what a photograph is to a computer, and why feeding one straight into an ordinary network is a bad idea.',
      objectives: [
        'Describe an image as a tensor and give its shape',
        'Compute how many inputs an image would present to a dense layer',
        'Explain the two problems convolution exists to solve'
      ],
      concepts: ['image-data'],
      requires: ['features', 'layers'],
      minutes: 13,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A greyscale image is a grid of numbers, one per pixel, usually 0 (black) to 255 (white). A colour image is three such grids — red, green and blue — stacked. Those stacked grids are called **channels**, and the whole thing is a **tensor**: an array with more than two dimensions.'
        },
        {
          kind: 'example',
          title: 'Shapes',
          text: '28 × 28 greyscale digit      →  (28, 28, 1)      =    784 numbers\n224 × 224 colour photograph  →  (224, 224, 3)    = 150,528 numbers\n1920 × 1080 colour frame     →  (1920, 1080, 3)  = 6,220,800 numbers\n\nA batch of 32 of the middle one is (32, 224, 224, 3) — the first dimension is almost always the batch.'
        },
        {
          kind: 'text',
          text: 'Pixel values are usually scaled to 0–1 or standardised before use, for exactly the reasons in Unit 02: a network trains badly on inputs in the hundreds.'
        },
        { kind: 'heading', text: 'Why a dense layer is hopeless on images' },
        {
          kind: 'text',
          text: 'Flatten a 224 × 224 colour image into a list of 150,528 numbers and feed it to a dense layer of 1,000 units. That layer alone has over 150 million weights. For one layer. There are two problems and the parameter count is the smaller one.'
        },
        {
          kind: 'list',
          ordered: true,
          items: [
            '**Nothing is shared.** The weights that learn to detect an edge in the top-left corner are completely separate from the weights in the bottom-right. The network would have to learn "edge" independently in every position, and would need training examples of every feature in every location.',
            '**Structure is thrown away.** Flattening destroys the fact that two pixels are neighbours. To a dense layer, the pixel to the left and a pixel 300 rows away are equally related — but in an image, nearby pixels are what carry meaning.'
          ]
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'Convolution fixes both at once. One small set of weights is reused at every position — which shares learning across the image and cuts parameters by orders of magnitude — and it reads a small neighbourhood at a time, which keeps the spatial structure. Everything in the next lesson follows from those two sentences.'
        },
        { kind: 'check', questionId: 'u8l1q1' },
        { kind: 'check', questionId: 'u8l1q2' }
      ],
      questions: [
        {
          id: 'u8l1q1',
          kind: 'number',
          concept: 'image-data',
          prompt: 'How many numbers are in a 64 × 64 colour image?',
          difficulty: 'beginner',
          answer: 12288,
          tolerance: 0.5,
          explanation: '64 × 64 × 3 = 12,288 — one value per pixel per colour channel.',
          hints: ['Width, height, and one value per channel.']
        },
        {
          id: 'u8l1q2',
          kind: 'multi',
          concept: 'image-data',
          prompt: 'What is wrong with flattening an image into a dense layer? Choose all that apply.',
          difficulty: 'intermediate',
          options: [
            'The parameter count becomes enormous',
            'Nothing is shared between positions, so a feature must be learned separately in every location',
            'Flattening loses the information that pixels are neighbours',
            'Dense layers cannot accept more than 1,000 inputs'
          ],
          answer: [0, 1, 2],
          explanation:
            'Parameters, no sharing, and lost structure. There is no technical limit on the number of inputs to a dense layer — the problems are statistical and computational rather than a hard restriction.',
          hints: ['One of these is simply not true of dense layers.']
        }
      ]
    },

    // ------------------------------------------------------------------ 2
    {
      id: 'u8l2',
      title: 'Convolution, feature maps and pooling',
      intro:
        'A small grid of weights slid across the image, computing a dot product at every position. One operation, and the whole of modern vision is built on it.',
      objectives: [
        'Compute the output of a convolution by hand on a small grid',
        'Explain stride, padding and the receptive field',
        'Say what pooling does and what it costs'
      ],
      concepts: ['convolution', 'feature-maps'],
      requires: ['image-data', 'dot-product'],
      minutes: 17,
      difficulty: 'advanced',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: 'A **kernel** (or filter) is a small grid of weights — 3 × 3 is the usual size. Lay it over the top-left corner of the image, multiply each kernel weight by the pixel underneath it, add the results: one number. Slide one pixel right and do it again. The grid of numbers you end up with is a **feature map**.'
        },
        {
          kind: 'example',
          title: 'One position, computed',
          text: 'Image patch        Kernel (vertical edge detector)\n 10  10  50        -1   0   1\n 10  10  50        -1   0   1\n 10  10  50        -1   0   1\n\n(10)(-1) + (10)(0) + (50)(1)  = 40\n(10)(-1) + (10)(0) + (50)(1)  = 40\n(10)(-1) + (10)(0) + (50)(1)  = 40\n                        total = 120\n\nA large positive number: this kernel has found a vertical edge going from dark to light. Over a flat region the same kernel gives zero.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'The kernel in that example was written by hand to make the arithmetic clear. In a convolutional network the kernel weights are **learned** — they start random and gradient descent decides what each one should detect. Early layers reliably end up with edge and colour detectors, because that is what the task needs first.'
        },
        { kind: 'heading', text: 'Stride, padding, and the output size' },
        {
          kind: 'list',
          items: [
            '**Stride** — how far the kernel moves each step. Stride 1 looks at every position; stride 2 skips every other one and halves the output size.',
            '**Padding** — a border of zeros added around the image. Without it, every convolution shrinks the image and the edges get less attention than the middle. "Same" padding keeps the output the same size as the input.'
          ]
        },
        { kind: 'formula', latex: '\\text{out} = \\left\\lfloor \\frac{\\text{in} + 2p - k}{s} \\right\\rfloor + 1', caption: 'Output side length from input side in, padding p, kernel size k and stride s. A 32-wide input with a 3-wide kernel, no padding and stride 1 gives 30.' },
        { kind: 'heading', text: 'Many kernels, and channels' },
        {
          kind: 'text',
          text: 'One kernel detects one thing. A convolutional layer has many — 32, 64, 256 — each producing its own feature map, so the layer output is a stack of maps. That stack is the input to the next layer, where each kernel now spans all the incoming channels at once. A 3 × 3 kernel over 64 input channels is really 3 × 3 × 64 weights.'
        },
        {
          kind: 'example',
          title: 'Counting parameters, and why it matters',
          text: 'A layer with 64 kernels of 3 × 3 over 32 input channels:\n\n  3 × 3 × 32 × 64 = 18,432 weights, plus 64 biases\n\nThe equivalent dense layer on a 224 × 224 × 32 input would have billions. That ratio is why convolution made vision possible.'
        },
        { kind: 'heading', text: 'Pooling' },
        {
          kind: 'text',
          text: '**Max pooling** takes the largest value in each small window — usually 2 × 2 — and throws the rest away, halving the width and height. It reduces computation, and it makes the representation slightly insensitive to exactly where a feature was: an edge that shifts by one pixel produces the same pooled output.'
        },
        {
          kind: 'text',
          text: 'The cost is precision of location, which matters. For classification — "is there a cat?" — losing a pixel of position is irrelevant. For segmentation — "which pixels are cat?" — it is a problem, which is why segmentation architectures have to recover resolution later.'
        },
        { kind: 'heading', text: 'The receptive field' },
        {
          kind: 'text',
          text: 'A neuron in the first layer sees a 3 × 3 patch. A neuron in the second layer sees a 3 × 3 patch *of first-layer outputs*, each of which saw 3 × 3 pixels — so it effectively sees 5 × 5 of the original image. Stack layers and pooling and the receptive field grows quickly, which is how a network built from tiny kernels ends up recognising whole objects.'
        },
        {
          kind: 'lab',
          appId: 'image-lab',
          title: 'Convolve something, and change the kernel',
          does:
            'Apply an edge-detecting kernel to a real image and look at the result. Then change the kernel values and watch what the output responds to. This is the operation every layer of a vision network performs, thousands of times.'
        },
        { kind: 'check', questionId: 'u8l2q1' },
        { kind: 'check', questionId: 'u8l2q2' },
        { kind: 'check', questionId: 'u8l2q3' }
      ],
      questions: [
        {
          id: 'u8l2q1',
          kind: 'number',
          concept: 'convolution',
          prompt: 'A 32 × 32 input, a 3 × 3 kernel, no padding, stride 1. What is the output width?',
          difficulty: 'intermediate',
          answer: 30,
          tolerance: 0.5,
          explanation: '(32 + 0 − 3) / 1 + 1 = 30. Without padding each convolution shrinks the image by k − 1.',
          hints: ['Count the positions the kernel can occupy along one edge.']
        },
        {
          id: 'u8l2q2',
          kind: 'number',
          concept: 'convolution',
          prompt: 'A layer has 16 kernels of size 3 × 3 over 8 input channels. How many weights, excluding biases?',
          difficulty: 'advanced',
          answer: 1152,
          tolerance: 0.5,
          explanation: '3 × 3 × 8 × 16 = 1,152. Each kernel spans every input channel, and there are sixteen of them.',
          hints: ['Each kernel is 3 × 3 × (input channels), and there are 16 kernels.']
        },
        {
          id: 'u8l2q3',
          kind: 'choice',
          concept: 'feature-maps',
          prompt: 'Why is convolution so much better suited to images than a dense layer?',
          difficulty: 'advanced',
          options: [
            'It runs faster on any hardware',
            'The same small set of weights is reused at every position, which shares learning across the image and cuts parameters enormously, and it reads neighbourhoods so spatial structure survives',
            'It can process colour, which dense layers cannot',
            'It avoids overfitting entirely'
          ],
          answer: 1,
          explanation:
            'Weight sharing and locality. A feature learned anywhere is available everywhere, and neighbouring pixels stay neighbours. Dense layers handle colour perfectly well, and convolution reduces but does not eliminate overfitting.',
          hints: ['Two properties, both mentioned at the end of the previous lesson.']
        }
      ]
    },

    // ------------------------------------------------------------------ 3
    {
      id: 'u8l3',
      title: 'Convolutional networks, and the three vision tasks',
      intro:
        'Stacking the pieces into an architecture, then keeping classification, detection and segmentation firmly apart — they need different labels, different outputs and different metrics.',
      objectives: [
        'Describe the standard shape of a convolutional classifier',
        'Distinguish classification, detection and segmentation by their outputs',
        'Explain IoU and what a detection metric has to account for'
      ],
      concepts: ['cnn', 'image-tasks'],
      requires: ['feature-maps', 'deep-learning'],
      minutes: 16,
      difficulty: 'advanced',
      required: true,
      blocks: [
        { kind: 'heading', text: 'The standard shape' },
        {
          kind: 'example',
          title: 'A convolutional classifier',
          text: 'input          224 × 224 × 3\nconv + ReLU    224 × 224 × 32     ─┐ edges, colour gradients\npool           112 × 112 × 32      │\nconv + ReLU    112 × 112 × 64      │ textures, corners\npool            56 ×  56 × 64      │\nconv + ReLU     56 ×  56 × 128     │ parts — wheels, eyes, letters\npool            28 ×  28 × 128    ─┘\nflatten        100,352\ndense + ReLU   256\ndense + softmax 10                   the classes'
        },
        {
          kind: 'text',
          text: 'The pattern is consistent: spatial size shrinks while channel count grows. The network trades "where" for "what" — early layers know precisely where a faint edge is, late layers know there is a cat somewhere. The convolutional part is a feature extractor; the dense layers on top are a classifier over those features.'
        },
        {
          kind: 'callout',
          tone: 'tip',
          text: 'That split is exactly what transfer learning exploits. Keep the feature extractor, replace the classifier. The features a network learned on a million photographs are useful for your fifteen classes too.'
        },
        { kind: 'heading', text: 'Three different tasks' },
        {
          kind: 'table',
          headers: ['Task', 'Question', 'Output', 'Label needed'],
          rows: [
            ['Classification', 'What is in this image?', 'One class, or a probability per class', 'A class per image'],
            ['Detection', 'What is here, and where?', 'A box, a class and a confidence per object', 'A box per object'],
            ['Segmentation', 'Which pixels belong to what?', 'A class for every pixel', 'A mask per image']
          ]
        },
        {
          kind: 'text',
          text: 'The cost of labelling rises steeply down that table. A class per image takes a second; a box per object takes a few seconds; a pixel mask can take minutes per image. Choosing detection when classification would answer the question is one of the more expensive mistakes available in a vision project.'
        },
        { kind: 'heading', text: 'Detection, and IoU' },
        {
          kind: 'text',
          text: 'A detector outputs boxes with classes and confidences. Judging a box needs a notion of "close enough", and that is **intersection over union**: the area where the predicted box and the real box overlap, divided by the area they cover together.'
        },
        { kind: 'formula', latex: '\\text{IoU} = \\frac{\\text{area of overlap}}{\\text{area of union}}', caption: '1.0 is a perfect box; 0 is no overlap at all. A threshold — commonly 0.5 — decides whether a prediction counts as a hit, which means the same detector can be reported as better or worse depending on the threshold chosen.' },
        {
          kind: 'list',
          items: [
            'A box above the IoU threshold with the right class: a true positive.',
            'A box matching nothing: a false positive.',
            'A real object with no box: a false negative — a missed detection.',
            'Two boxes on one object: one counts, the other is a false positive. Suppressing those duplicates is part of every detector.'
          ]
        },
        {
          kind: 'text',
          text: 'Detection metrics therefore combine the classification metrics from Unit 03 with localisation, usually as average precision over the whole precision-recall curve, averaged across classes — **mAP**. When a paper reports mAP, the IoU threshold is part of the claim.'
        },
        { kind: 'heading', text: 'Segmentation' },
        {
          kind: 'text',
          text: 'Per-pixel classification. Because pooling has destroyed resolution, segmentation architectures add an upsampling path that rebuilds it, with connections across from the matching early layers so fine detail is restored rather than invented. The usual metric is again IoU, computed per class over pixels.'
        },
        {
          kind: 'lab',
          appId: 'image-lab',
          title: 'Classify, and then look at the mistakes',
          does:
            'Train a small image classifier and read its confusion matrix. Then look at the images it got wrong, one by one — the error-analysis habit from Unit 04, applied where it is easiest to see.'
        },
        { kind: 'check', questionId: 'u8l3q1' },
        { kind: 'check', questionId: 'u8l3q2' }
      ],
      questions: [
        {
          id: 'u8l3q1',
          kind: 'choice',
          concept: 'image-tasks',
          prompt: 'You need to know how many people are in a photograph and where each one is. Which task?',
          difficulty: 'intermediate',
          options: [
            'Classification',
            'Object detection — it returns a box per object, which gives both the count and the positions',
            'Segmentation, since it is the most detailed',
            'Regression on the pixel values'
          ],
          answer: 1,
          explanation:
            'Detection gives one box per instance, so counting and locating both come out of it. Classification cannot count instances. Segmentation would label every person pixel but not separate two people standing together without the instance variant, and its labels cost far more.',
          hints: ['Which output form gives you one thing per person?']
        },
        {
          id: 'u8l3q2',
          kind: 'choice',
          concept: 'image-tasks',
          prompt: 'What does an IoU of 0.9 between a predicted and a real box mean?',
          difficulty: 'advanced',
          options: [
            'The classifier is 90% confident',
            'The boxes overlap closely — the shared area is 90% of the combined area',
            '90% of the object is inside the box',
            'The model is right 90% of the time'
          ],
          answer: 1,
          explanation:
            'IoU is purely geometric: overlap divided by union. It says nothing about confidence or about how often the model is right — those are separate numbers that a detection metric combines with it.',
          hints: ['Read the name: intersection over union.']
        },
        {
          id: 'u8l3q3',
          kind: 'short',
          concept: 'cnn',
          prompt: 'In a convolutional classifier, what happens to spatial size and channel count as you go deeper?',
          difficulty: 'intermediate',
          answer: 'spatial size shrinks and the number of channels grows',
          accepts: [
            'size down channels up',
            'smaller spatially, more channels',
            'resolution falls, depth increases',
            'width and height shrink, channels increase'
          ],
          explanation:
            'The network trades location for description: it stops knowing precisely where things are and starts knowing what they are. That is also why segmentation has to rebuild resolution afterwards.',
          hints: ['Look at the shapes in the architecture diagram.']
        }
      ]
    },

    // ------------------------------------------------------------------ 4
    {
      id: 'u8l4',
      title: 'Augmentation and image processing',
      intro:
        'Making more training data out of the data you have — and the classical operations that still do half the work in real vision systems.',
      objectives: [
        'Choose augmentations that preserve the label, and reject ones that do not',
        'Explain what common filters do and when to reach for them',
        'Say why preprocessing has to be identical in training and production'
      ],
      concepts: ['augmentation', 'image-processing'],
      requires: ['cnn', 'overfitting'],
      minutes: 15,
      difficulty: 'intermediate',
      required: true,
      blocks: [
        {
          kind: 'text',
          text: '**Augmentation** creates new training examples by transforming existing ones. A cat rotated five degrees is still a cat, so it is a free extra example — and the network learns that small rotations do not change the answer, which is what you wanted it to know.'
        },
        {
          kind: 'table',
          headers: ['Transformation', 'Usually safe', 'Careful'],
          rows: [
            ['Horizontal flip', 'Animals, objects, faces', 'Text, digits, road signs, anything handed'],
            ['Small rotation (±10°)', 'Most natural images', 'Documents, where orientation is the task'],
            ['Crop and resize', 'Most tasks', 'When the object may be cropped out entirely'],
            ['Brightness and contrast', 'Most tasks', 'Medical imaging, where intensity is diagnostic'],
            ['Colour shift', 'General objects', 'When colour is the label — ripe or unripe fruit'],
            ['Noise, blur', 'Robustness to poor cameras', 'When sharpness is what is being assessed'],
            ['Vertical flip', 'Satellite and microscope images', 'Almost anything photographed by a person']
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          text: 'The rule is one sentence: **the transformation must not change the correct answer.** Flipping a 6 horizontally is still roughly a 6; flipping it vertically makes something that is arguably a 9. Mirroring an X-ray swaps left and right, which in a clinical context can be the diagnosis. A wrong augmentation teaches the model something false, and it is very hard to find afterwards.'
        },
        {
          kind: 'text',
          text: 'Augmentation applies to the **training** set only. Augmenting validation or test data changes what you are measuring — you would be reporting performance on images nobody will ever send you.'
        },
        { kind: 'heading', text: 'Classical image processing' },
        {
          kind: 'text',
          text: 'Not everything needs a network. These operations are fast, exact, explainable, and still the right answer surprisingly often — and several of them are the fixed-kernel ancestors of convolution.'
        },
        {
          kind: 'table',
          headers: ['Operation', 'What it does', 'Used for'],
          rows: [
            ['Greyscale', 'Collapses colour to intensity', 'When colour is irrelevant — cuts the data by two thirds'],
            ['Histogram equalisation', 'Spreads intensity to use the full range', 'Low-contrast photographs, medical images'],
            ['Blur', 'Averages each pixel with its neighbours', 'Removing noise before further processing'],
            ['Sharpen', 'Amplifies local differences', 'Making edges more distinct'],
            ['Edge detection', 'Highlights sudden intensity changes', 'Finding outlines and boundaries'],
            ['Threshold', 'Everything becomes black or white at a cutoff', 'Separating an object from its background'],
            ['Morphology', 'Grows or shrinks shapes in a binary image', 'Cleaning up speckle after thresholding']
          ]
        },
        {
          kind: 'text',
          text: 'A **histogram** — how many pixels at each intensity — is the diagnostic tool underneath several of these. A photograph with everything bunched at the dark end is underexposed, and equalisation spreads it out. It is worth being able to read one.'
        },
        {
          kind: 'callout',
          tone: 'note',
          text: 'Every one of these operations destroys information. Thresholding is the extreme case: once an image is black and white, the shading is gone and no later step can recover it. Do the destructive steps as late as possible in a pipeline, and keep the original.'
        },
        { kind: 'heading', text: 'Preprocessing has to match' },
        {
          kind: 'text',
          text: 'Whatever you did to training images — resized to 224, scaled to 0–1, standardised with particular channel means — must happen identically in production, in the same order. This is the training-serving mismatch from Unit 03, and in vision it is especially easy to get wrong because resizing and colour-channel order differ between libraries. A model fed BGR when it was trained on RGB still returns confident answers, and they are wrong.'
        },
        {
          kind: 'lab',
          appId: 'image-lab',
          title: 'Filters, and what each one throws away',
          does:
            'Apply blur, sharpen, edge detection and a threshold to the same image, in different orders. Then try to recover the original from the thresholded version — you cannot, which is the point of the warning above.'
        },
        { kind: 'check', questionId: 'u8l4q1' },
        { kind: 'check', questionId: 'u8l4q2' }
      ],
      questions: [
        {
          id: 'u8l4q1',
          kind: 'choice',
          concept: 'augmentation',
          prompt: 'You are classifying handwritten digits. Which augmentation is a mistake?',
          difficulty: 'intermediate',
          options: [
            'Small rotations of a few degrees',
            'Slight scaling',
            'Horizontal flipping',
            'Small shifts in position'
          ],
          answer: 2,
          explanation:
            'Flipping changes the label: a flipped 2 is not a 2, and a flipped 6 is close to a 9. The other three preserve digit identity, which is exactly the test to apply.',
          hints: ['Apply the rule: does the correct answer survive the transformation?']
        },
        {
          id: 'u8l4q2',
          kind: 'choice',
          concept: 'image-processing',
          prompt: 'Why should thresholding come late in a processing pipeline?',
          difficulty: 'intermediate',
          options: [
            'Because it is slow',
            'Because it is irreversible — all shading is lost, so nothing afterwards can use it',
            'Because it only works on colour images',
            'Because it must follow edge detection'
          ],
          answer: 1,
          explanation:
            'Thresholding reduces every pixel to one of two values. Any later step needing intensity has nothing to work with, and the original cannot be recovered. Destructive steps go last, and the original is kept.',
          hints: ['What information is there afterwards?']
        },
        {
          id: 'u8l4q3',
          kind: 'true-false',
          concept: 'augmentation',
          prompt: 'Augmentation should be applied to the validation and test sets as well, for consistency.',
          difficulty: 'intermediate',
          answer: false,
          explanation:
            'Training only. Validation and test exist to estimate performance on real incoming data, and augmenting them means measuring performance on images nobody will send you.',
          hints: ['What are those two sets for?']
        }
      ]
    }
  ]
}
