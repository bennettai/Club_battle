# AI Sketch Guess
A small CNN that guesses doodles drawn on a 512×512 canvas.
The classifier uses Google's Quick, Draw! dataset.
Install dependencies: `pip install -r requirement.txt`
Download classes: `python src/guess/data.py --classes cat dog`
Train the model: `python src/guess/guess.py train --classes cat dog --download`
Start the canvas: `python src/test/canvas.py`
Predictions are printed in the terminal every 1.5 seconds.
