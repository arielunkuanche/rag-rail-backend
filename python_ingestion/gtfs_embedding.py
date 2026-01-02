from sentence_transformers import SentenceTransformer
from typing import List, Dict
from datetime import datetime, timezone
import time
import numpy as np
from config import EMBEDDING_MODEL


class EmbeddingGenerator:
    def __init__(self, model_name: str = EMBEDDING_MODEL, max_docs: int = 100000):
        """Initialize the embedding model."""
        print(f"Chunk & Embed model: {model_name}")
        start = time.time()

        self.model = SentenceTransformer(model_name)
        self.max_docs = max_docs
        print(f"Model loaded successfully {time.time() - start: .2f} s")

    def generate_embedding_single(self, text: str) -> List[float]:
        """Generate embedding for a single text query."""

        print(f"8. Single query embedding starts...")
        if not text:
            return []
        embedding = self.model.encode(
            text, 
            convert_to_numpy=True,
            show_progress_bar=False,
            batch_size=1
        )
        # The result is a 1x384 NumPy array; we extract the first (and only) vector
        # and convert it to a Python list for easy return/transfer (e.g., to Node.js).
        print(f" ✅ single query embedding results: {embedding}")
        return embedding[0].tolist()
    
    def _batch_iterator(self, data: List[Dict], batch_size: int):
        for i in range(0, len(data), batch_size):
            yield data[i:i + batch_size], i

    def generate_embedding_batch(self, documents: List[Dict], batch_size: int = 128) -> List[Dict]:
        """Generate embeddings for multiple texts in batches."""
        if not documents:
            print("⚠️ No documents to embed.")
            return []
        
        total_docs = len(documents)
        if total_docs > self.max_docs:
            print(f"⚠️ Limiting to {self.max_docs} documents (Atlas Free Tier) currently.")
            documents = documents[:self.max_docs]
            total_docs = self.max_docs

        print(f"--- 6. Batch embedding starts for {total_docs} documents ---")
        for batch, start_idx in self._batch_iterator(documents, batch_size):
            texts = [d['text'] for d in batch]
            try:
                batch_embeddings = self.model.encode(
                    texts,
                    batch_size=batch_size,
                    show_progress_bar=True,
                    convert_to_numpy=True
                )
            except Exception as e:
                print(f"⚠️ Error encoding batch starting at {start_idx}: {e}")
                continue

            for i, emb in enumerate(batch_embeddings):
                # Fixed: Explicitly cast to float type before converting to list
                batch[i]['embedding'] = emb.astype(float).tolist()
                batch[i]['metadata']['embedded_at'] = datetime.now(timezone.utc).isoformat()

            if (start_idx + len(batch)) % (batch_size * 5) == 0:
                print(f"   -> Embedded {start_idx + len(batch)} / {total_docs} docs")

        print("✅ Embedding generation completed.")
        return documents