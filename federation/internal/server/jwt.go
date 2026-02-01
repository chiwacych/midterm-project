package server

import (
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

var publicKey *rsa.PublicKey

func init() {
	pemStr := os.Getenv("JWT_PUBLIC_KEY_PEM")
	if pemStr == "" {
		return
	}
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return
	}
	key, err := jwt.ParseRSAPublicKeyFromPEM([]byte(pemStr))
	if err != nil {
		return
	}
	publicKey = key
}

// ValidateJWT validates a JWT (RS256) using the public key from JWT_PUBLIC_KEY_PEM.
// If no key is set, validation is skipped (for dev).
func ValidateJWT(tokenString string) error {
	if publicKey == nil {
		return nil // no key configured: allow (dev mode)
	}
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return publicKey, nil
	})
	if err != nil {
		return err
	}
	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		_ = claims
		return nil
	}
	return fmt.Errorf("invalid token")
}

// ExtractBearerToken returns the token from "Bearer <token>" or empty.
func ExtractBearerToken(auth string) string {
	return strings.TrimPrefix(auth, "Bearer ")
}
